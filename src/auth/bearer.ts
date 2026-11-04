// src/auth/bearer.ts
//
// #634: the OIDC bearer middleware and the RFC 9728 protected resource metadata router,
// built in. They replace the `mcp-auth` package, whose zod 3 dependency carried
// GHSA-mrhx-c7xc-m3w5 and which we used for exactly these two pieces (the JWT check
// itself has always been our own jose verifier in httpServer.ts).
//
// The observable behaviour is mcp-auth 0.2.0's, response for response: status codes,
// the WWW-Authenticate value, the snake_cased JSON body, and the CORS headers on the
// metadata route. tests/unit/oidc_bearer_middleware.test.js replays the responses
// captured from that version (tests/unit/fixtures/mcp-auth-0.2.0-golden.json) against
// this module, so a client that worked before sees no difference. Two deliberate
// departures: no console.warn when req.auth is already set (server code never writes
// to the console, stdout is the stdio channel), and an unexpected error goes to
// next(err) explicitly instead of escaping an async handler (Express 5 forwarded that
// rejection to the same place).

import express from 'express';
import type { NextFunction, Request, Response } from 'express';

const METADATA_ROOT = '/.well-known/oauth-protected-resource';

/** What a verifier returns for a valid token; becomes `req.auth`. */
export interface AuthInfo {
  token: string;
  subject?: string;
  issuer: string;
  clientId: string;
  audience?: string | string[];
  scopes: string[];
  expiresAt?: number;
  claims?: Record<string, unknown>;
}

const BEARER_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  missing_auth_header: 'Missing `Authorization` header. Please provide a valid bearer token.',
  invalid_auth_header_format: 'Invalid `Authorization` header format. Expected "Bearer <token>".',
  missing_bearer_token: 'Missing bearer token in `Authorization` header. Please provide a valid token.',
  invalid_issuer: 'The token issuer does not match the expected issuer.',
  invalid_audience: 'The token audience does not match the expected audience.',
  missing_required_scopes: 'The token does not contain the necessary scopes for this request.',
  invalid_token: 'The provided token is not valid or has expired.',
});

const VERIFICATION_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  invalid_token: 'The provided token is invalid or malformed.',
  token_verification_failed: 'Token verification failed due to an error.',
});

/** Drop the entries a response must not carry (mcp-auth's condObject). */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => Boolean(v)));
}

abstract class AuthError extends Error {
  constructor(readonly code: string, message: string, override readonly cause?: unknown) {
    super(message);
  }

  toJson(showCause = false): Record<string, unknown> {
    return compact({ error: this.code, errorDescription: this.message, cause: showCause && this.cause });
  }
}

/** Thrown by a verifier: the token itself is bad. Always answered 401. */
export class TokenVerificationError extends AuthError {
  constructor(code: 'invalid_token' | 'token_verification_failed', cause?: unknown) {
    super(code, VERIFICATION_DESCRIPTIONS[code] ?? 'An error occurred while verifying the token.', cause);
    this.name = 'TokenVerificationError';
  }
}

/** The header, issuer, audience or scopes failed. 403 for missing scopes, else 401. */
export class BearerAuthError extends AuthError {
  constructor(code: string, cause?: Record<string, unknown>) {
    super(code, BEARER_DESCRIPTIONS[code] ?? 'An error occurred with the Bearer auth.', cause);
    this.name = 'BearerAuthError';
  }

  override toJson(showCause = false): Record<string, unknown> {
    const cause = this.cause as { uri?: { href?: string }; missingScopes?: string[] } | undefined;
    // missingScopes is reported even without details, as mcp-auth did.
    return compact({ ...super.toJson(showCause), errorUri: cause?.uri?.href, missingScopes: cause?.missingScopes });
  }
}

/** Deep camelCase to snake_case on keys only; values (strings in arrays included) are kept. */
function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(), snakeKeys(v)]),
  );
}

/**
 * The RFC 9728 metadata URL for a resource identifier: the well-known root for an origin
 * (or `/`), else the root followed by the resource's path. The query is dropped and a
 * trailing slash is kept.
 */
export function resourceMetadataEndpoint(resource: string): URL {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new TypeError(`Invalid resource identifier URI: ${resource}`);
  }
  return new URL(url.pathname === '/' ? METADATA_ROOT : `${METADATA_ROOT}${url.pathname}`, url.origin);
}

function bearerToken(header: string | undefined): string {
  if (!header) throw new BearerAuthError('missing_auth_header');
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || rest.length > 0) throw new BearerAuthError('invalid_auth_header_format');
  if (!token) throw new BearerAuthError('missing_bearer_token');
  return token;
}

export interface BearerAuthOptions {
  /** Trusted issuers; `AuthInfo.issuer` must be one of them. */
  issuers: string[];
  /** When set, its metadata URL goes into the 401 WWW-Authenticate `resource_metadata`. */
  resource?: string;
  requiredScopes?: string[];
  /** When set, `AuthInfo.audience` must equal it (a string) or include it (an array). */
  audience?: string;
  /** Include the error's cause in the body. Off in production. */
  showErrorDetails?: boolean;
}

export type VerifyAccessToken = (token: string) => Promise<AuthInfo>;

/**
 * Express middleware: read the bearer token, verify it, check issuer, audience and scopes,
 * then set `req.auth` and continue. An auth failure is answered here; any other error goes
 * to `next(err)`.
 */
export function bearerAuthMiddleware(verify: VerifyAccessToken, opts: BearerAuthOptions): express.RequestHandler {
  const { issuers, requiredScopes, audience, showErrorDetails = false } = opts;
  const metadataUrl = opts.resource ? resourceMetadataEndpoint(opts.resource).toString() : undefined;

  return async (req: Request, res: Response, next: NextFunction) => {
    let authInfo: AuthInfo;
    try {
      authInfo = await verify(bearerToken(req.headers.authorization));
      if (!issuers.includes(authInfo.issuer)) {
        throw new BearerAuthError('invalid_issuer', { expected: issuers.join(', '), actual: authInfo.issuer });
      }
      if (audience && (Array.isArray(authInfo.audience) ? !authInfo.audience.includes(audience) : authInfo.audience !== audience)) {
        throw new BearerAuthError('invalid_audience', { expected: audience, actual: authInfo.audience });
      }
      const missingScopes = (requiredScopes ?? []).filter((s) => !authInfo.scopes.includes(s));
      if (missingScopes.length > 0) throw new BearerAuthError('missing_required_scopes', { missingScopes });
    } catch (err) {
      if (!(err instanceof AuthError)) {
        next(err);
        return;
      }
      const status = err instanceof BearerAuthError && err.code === 'missing_required_scopes' ? 403 : 401;
      const params: Array<[string, string | undefined]> = [
        ['error', err.code],
        ['error_description', err.message],
        ['resource_metadata', status === 401 ? metadataUrl : undefined],
      ];
      const header = params.filter(([, v]) => v).map(([k, v]) => `${k}="${v}"`).join(', ');
      res.set('WWW-Authenticate', `Bearer ${header}`).status(status).json(snakeKeys(err.toJson(showErrorDetails)));
      return;
    }
    (req as Request & { auth?: AuthInfo }).auth = authInfo;
    next();
  };
}

export interface ResourceMetadataOptions {
  /** The raw OIDC_RESOURCE string, published verbatim as `resource`. */
  resource: string;
  issuer: string;
  scopesSupported: string[];
}

/**
 * Serves the RFC 9728 document at the resource's metadata path, with open CORS on that path
 * and everything under it (the document is public by design, and mcp-auth mounted cors()
 * the same way). Only GET (and so HEAD) is routed; other methods fall through.
 */
export function resourceMetadataRouter(opts: ResourceMetadataOptions): express.Router {
  const path = resourceMetadataEndpoint(opts.resource).pathname;
  const body = { resource: opts.resource, scopes_supported: opts.scopesSupported, authorization_servers: [opts.issuer] };
  const router = express.Router();
  router.use(path, (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'OPTIONS') {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    const requested = req.headers['access-control-request-headers'];
    if (requested) res.setHeader('Access-Control-Allow-Headers', requested);
    res.setHeader('Vary', 'Access-Control-Request-Headers');
    res.statusCode = 204;
    res.setHeader('Content-Length', '0');
    res.end();
  });
  router.get(path, (_req, res) => {
    res.status(200).json(body);
  });
  return router;
}
