// src/lib/oidc-token-source.ts
//
// #462: where the bearer JWT comes from. Cloudflare's documented pattern for an MCP
// server behind Access with Managed OAuth: the client sends an OPAQUE access token as
// the bearer, Cloudflare resolves it at the edge and forwards a signed JWT in
// `Cf-Access-Jwt-Assertion`, and "the MCP server must validate the Access JWT sent in
// the Cf-Access-Jwt-Assertion header". mcp-auth reads only `headers.authorization`, so
// this module promotes the assertion into that slot BEFORE `bearerAuth` runs, and
// everything downstream (signature, issuer, closed audience allowlist, non-empty sub,
// budget ACL) is the code that already verifies any bearer JWT.
//
// ONE token source per mode, ONE verification per request, no fallback (gate decision
// D4): in assertion mode `Authorization` is never consulted. A missing, empty,
// whitespace-containing or duplicate assertion header deletes `authorization`, so
// mcp-auth answers 401 `missing_auth_header`. That is what makes the mode a narrowing
// and never a widening: a valid JWT arriving as a bearer at the origin with no
// assertion is the captured-assertion-direct-to-origin case and is refused.
//
// Why whitespace is refused rather than trimmed (D3): a compact JWS never contains
// whitespace, Node's parser already strips OWS, and Node joins DUPLICATE custom headers
// with ", ". Two assertion headers therefore arrive as one whitespace-containing string
// and are refused, rather than one of them being silently chosen.
//
// Pure: imports neither config, logger nor Express. The composition root passes
// `config.OIDC_TOKEN_SOURCE` in; `httpServer.ts` never names a header, and adding a
// second edge value is an enum entry, a table entry here and a SENSITIVE_KEYS entry in
// logger.ts (a literal there, because logger.ts loads before config.ts). The
// `satisfies` clause makes a missing table entry a compile error.

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

export type OidcTokenSource = 'authorization' | 'cf-access-jwt-assertion';

/** Header carrying the JWT for every non-`authorization` source (lowercase, as Node exposes it). */
export const ASSERTION_HEADERS = {
  'cf-access-jwt-assertion': 'cf-access-jwt-assertion',
} as const satisfies Record<Exclude<OidcTokenSource, 'authorization'>, string>;

/**
 * The full value to place in `headers.authorization` for the configured source, or
 * `undefined` when the request must be refused. For `authorization` the existing value
 * is returned untouched (this function is then a no-op for the caller).
 */
export function promoteAssertionHeader(headers: IncomingHttpHeaders, source: OidcTokenSource): string | undefined {
  if (source === 'authorization') {
    return typeof headers.authorization === 'string' ? headers.authorization : undefined;
  }
  const raw = headers[ASSERTION_HEADERS[source]];
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  if (/\s/.test(raw)) return undefined;
  return `Bearer ${raw}`;
}

type Next = (err?: unknown) => void;

/**
 * Express-shaped middleware that rewrites `req.headers.authorization` in place from the
 * configured source. Mount it FIRST in the same chain as `bearerAuth`. With source
 * `authorization` it is the identity middleware.
 */
export function createAssertionPromotionMiddleware(source: OidcTokenSource) {
  return function promoteAssertion(req: IncomingMessage, _res: ServerResponse, next: Next): void {
    if (source !== 'authorization') {
      const promoted = promoteAssertionHeader(req.headers, source);
      if (promoted === undefined) delete req.headers.authorization;
      else req.headers.authorization = promoted;
    }
    next();
  };
}
