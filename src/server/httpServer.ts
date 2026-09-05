// src/server/httpServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.ts';
import express, { Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import logger, { resolveRequestId } from '../logger.js';
import { getLocalIp } from '../utils.js';
import actualToolsManager from '../actualToolsManager.js';
import { getConnectionState, connectToActualForSession, shutdownActualForSession, shutdownActual, canAcceptNewSession } from '../actualConnection.js';
import { connectionPool } from '../lib/ActualConnectionPool.js';
import observability from '../observability.js';
import config from '../config.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { MCPAuthTokenVerificationError } from 'mcp-auth';
import { createMcpAuth } from '../auth/setup.js';
import { discoverOidcMetadata, buildTrustedJwksHosts, setResolvedOidcMetadata } from '../lib/oidc-discovery.js';
import { buildAcceptedAudiences } from '../lib/oidc-audiences.js';
import { budgetAclMiddleware } from '../auth/budget-acl.js';
import { runAclPreflight } from '../auth/budget-acl-dynamic.js';
import * as https from 'node:https';
import * as fs from 'node:fs';

// AsyncLocalStorage for request context: moved to src/lib/requestContext.ts
// so adapter code can import it without a circular dependency on httpServer.
// Re-exported here for backward compatibility with any callers that imported
// `requestContext` from this module.
import { requestContext } from '../lib/requestContext.js';
import { buildToolListEntries } from '../lib/tool-list-entry.js';

/**
 * #438: classify a session-init failure into a CLOSED enum plus our own sentence.
 *
 * PURE and TOTAL: it never throws, never reads I/O, and never returns anything
 * derived from the caught value. That last property is the wire contract: the
 * response carries the enum member and the fixed sentence below and nothing
 * else, so no upstream string reaches a remote client and no scrubber has to be
 * correct. Upstream strings can carry a stack, raw SQL (`SyncError.meta.query`),
 * an `EACCES ... mkdir '/home/<user>/.actual'` path, and a configured server URL.
 *
 * Exported for tests: there is NO fault-injection seam in actualConnection.ts or
 * the pool, and booting against a closed port reaches only `network-failure`, so
 * every other class is covered by calling this directly with synthetic values.
 */
export type InitFailureCause =
  | 'schema_too_new' | 'auth_failed' | 'network_unreachable' | 'budget_not_found'
  | 'out_of_sync' | 'encryption_error' | 'clock_drift' | 'permission_denied'
  | 'timeout' | 'unknown';

const INIT_FAILURE_SENTENCES: Record<InitFailureCause, string> = {
  schema_too_new: "The Actual server's database schema is newer than the @actual-app/api this build bundles. Upgrade actual-mcp-server, or hold the server upgrade until its dependency update ships.",
  auth_failed: 'Authentication against the Actual server failed. Check ACTUAL_PASSWORD and the budget password.',
  // Deliberately not asserting permanence: ECONNRESET and ETIMEDOUT are classed
  // TRANSIENT by isRetryableError, so this can be a blip rather than misconfiguration.
  network_unreachable: 'The Actual server could not be reached, which may be transient. If it persists, check ACTUAL_SERVER_URL and that the server is running.',
  budget_not_found: 'The configured budget was not found on the Actual server. Check ACTUAL_BUDGET_SYNC_ID.',
  out_of_sync: 'The local budget copy is out of sync with the Actual server and could not be reconciled.',
  encryption_error: "The budget's end-to-end encryption password is wrong or missing.",
  clock_drift: "The host clock differs too far from the Actual server's. Fix the system time.",
  // A filesystem permission error, WITHOUT claiming which path: the classifier
  // sees only the errno, and EACCES can come from the data directory, TLS
  // material, or a socket during api.init.
  permission_denied: 'The server was denied filesystem access while initialising. Check the data directory mount and its ownership first, then any TLS material.',
  timeout: 'Initialising the Actual connection ran out of time, which may be transient.',
  unknown: 'The Actual connection for this session could not be initialised. See the server log for the cause.',
};

/** Actual's own reason strings, from `withErrorCode` and SyncError, to our enum.
 *  `out-of-sync-migrations` maps to schema_too_new, NOT out_of_sync: `invalid-schema`
 *  is absent from budgetLoader's KNOWN_LOAD_REASONS, so migrations is the only route
 *  by which a too-new schema surfaces on the post-condition path, and upstream's own
 *  sentence for it is "This budget cannot be loaded with this version of the app." */
const REASON_TO_CAUSE: Record<string, InitFailureCause> = {
  'invalid-schema': 'schema_too_new',
  'out-of-sync-migrations': 'schema_too_new',
  'out-of-sync': 'out_of_sync',
  'out-of-sync-data': 'out_of_sync',
  'budget-not-found': 'budget_not_found',
  'clock-drift': 'clock_drift',
  'encrypt-failure': 'encryption_error',
  'decrypt-failure': 'encryption_error',
  'missing-key': 'encryption_error',
};

/** Node fs/net codes. A DIFFERENT namespace from Actual's reasons, deliberately
 *  kept in its own table so the two can never be conflated. */
const SYSTEM_CODE_TO_CAUSE: Record<string, InitFailureCause> = {
  EACCES: 'permission_denied',
  EPERM: 'permission_denied',
  EROFS: 'permission_denied',
  ECONNREFUSED: 'network_unreachable',
  ENOTFOUND: 'network_unreachable',
  ECONNRESET: 'network_unreachable',
  EHOSTUNREACH: 'network_unreachable',
  ETIMEDOUT: 'timeout',
};

export function classifyInitFailure(err: unknown): { cause: InitFailureCause; sentence: string } {
  const done = (cause: InitFailureCause) => ({ cause, sentence: INIT_FAILURE_SENTENCES[cause] });
  try {
    const e = err as { code?: unknown; reason?: unknown; message?: unknown } | null | undefined;

    // `.code` FIRST: upstream's api/download-budget and api/load-budget never let a
    // SyncError escape, they throw a plain Error carrying .code via withErrorCode.
    const code = typeof e?.code === 'string' ? e.code : undefined;
    if (code && REASON_TO_CAUSE[code]) return done(REASON_TO_CAUSE[code]);
    if (code && SYSTEM_CODE_TO_CAUSE[code]) return done(SYSTEM_CODE_TO_CAUSE[code]);

    // `.reason` only as a defensive fallback, for a SyncError that reaches us by
    // some path that does not go through those two handlers.
    const reason = typeof e?.reason === 'string' ? e.reason : undefined;
    if (reason && REASON_TO_CAUSE[reason]) return done(REASON_TO_CAUSE[reason]);

    const message = typeof e?.message === 'string' ? e.message : '';

    // Our OWN synthesized post-condition error (#396) embeds the upstream reason
    // in prose. On a resync of an existing local copy this is the shape that
    // actually arrives for the schema and migration classes, so a classifier that
    // handled only the upstream shapes would answer `unknown` for exactly the
    // failures this ticket is about.
    const embedded = /Upstream reason: \[([a-z-]+)\]/.exec(message)?.[1];
    if (embedded && REASON_TO_CAUSE[embedded]) return done(REASON_TO_CAUSE[embedded]);

    // Last resort, message shapes. `network-failure` is tested BEFORE the auth
    // wording because upstream reports an unreachable server as
    // "Authentication failed: network-failure", where the actionable half is the
    // network, not the credentials.
    if (/network-failure|ECONNREFUSED|ENOTFOUND/i.test(message)) return done('network_unreachable');
    if (/timed out|ETIMEDOUT/i.test(message)) return done('timeout');
    if (/Authentication failed|invalid-password|Invalid password/i.test(message)) return done('auth_failed');
    if (/invalid-schema/i.test(message)) return done('schema_too_new');
    return done('unknown');
  } catch {
    // TOTAL by construction: a classifier that throws would land on the outer POST
    // catch and egress as raw String(err), defeating this contract through the one
    // line deliberately left to #446.
    return done('unknown');
  }
}

export { requestContext };

// Resolve the authenticated principal for the per-principal budget preference
// (#189). OIDC: the verified JWT subject. Static-bearer: a single shared
// identity (all bearer callers are the same user). Auth-disabled: undefined, so
// the preference simply no-ops. Never derived from a client-supplied value.
function resolvePrincipal(req: Request): string | undefined {
  if (config.AUTH_PROVIDER === 'oidc') {
    return (req as Request & { auth?: { subject?: string } }).auth?.subject;
  }
  return config.MCP_SSE_AUTHORIZATION ? 'static-bearer' : undefined;
}

export async function startHttpServer(
  mcp: ActualMCPConnection,
  port: number,
  httpPath: string,
  capabilities: Record<string, object>,          // was passed by index.ts
  implementedTools: string[],                    // was passed by index.ts
  serverDescription: string,                     // was passed by index.ts
  serverInstructions: string,                    // was passed by index.ts
  toolSchemas: Record<string, unknown>,              // was passed by index.ts
  version: string,                               // server version from package.json
  bindHost = 'localhost',                        // #239: interface to bind; forwarded to listen()
  advertisedUrl?: string
) {
  const app = express();
  // Explicit body-size cap (#168). An oversized payload is rejected with HTTP 413
  // rather than buffered unbounded. Tunable via MCP_HTTP_BODY_LIMIT (default 512kb).
  app.use(express.json({ limit: config.MCP_HTTP_BODY_LIMIT }));
  const scheme = config.MCP_ENABLE_HTTPS ? 'https' : 'http';

  // --- OIDC / mcp-auth (CF-5) ---
  // When AUTH_PROVIDER=oidc, validate JWTs and enforce budget ACL.
  // When AUTH_PROVIDER=none (default), the existing static Bearer token check applies.
  let mcpAuth: ReturnType<typeof createMcpAuth> = null;
  if (config.AUTH_PROVIDER === 'oidc') {
    mcpAuth = createMcpAuth();   // throws if OIDC_ISSUER / OIDC_RESOURCE missing
    if (mcpAuth) {
      // Serve RFC 8707 Protected Resource Metadata (/.well-known/oauth-protected-resource/...)
      app.use(mcpAuth.protectedResourceMetadataRouter());
      // Protect ALL httpPath routes with JWT validation + budget ACL
      const requiredScopes = config.OIDC_SCOPES
        ? config.OIDC_SCOPES.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      // #245: the strict, closed audience allowlist (OIDC_RESOURCE plus any
      // explicitly configured OIDC_ACCEPTED_AUDIENCES). jose treats the array as
      // match-any membership, so an IdP that puts the client-id in `aud` works
      // while an `aud` outside the set is still rejected (#160 preserved). No
      // wildcard, empties filtered; default is exactly [OIDC_RESOURCE].
      const acceptedAudiences = buildAcceptedAudiences(config.OIDC_RESOURCE, config.OIDC_ACCEPTED_AUDIENCES);
      // #245: fail closed if the allowlist is empty (e.g. a whitespace-only
      // OIDC_RESOURCE that passes the truthy check in setup.ts but trims away).
      // Never fall through to "no audience option", which would disable the #160
      // audience check and accept any aud from the trusted issuer.
      if (acceptedAudiences.length === 0) {
        throw new Error(
          'OIDC mode requires a non-empty OIDC_RESOURCE (the JWT audience). Refusing to start ' +
            'without audience enforcement, which would allow cross-relying-party token replay (#160/#245).',
        );
      }

      // Custom jose-based JWT verifier that bypasses mcp-auth's strict PKCE/discovery
      // validation that fails when the IdP (e.g. Casdoor v2.13) doesn't advertise
      // code_challenge_methods_supported in its discovery document.
      // #244: resolve the JWKS URI from the issuer's OpenID discovery document
      // instead of a hardcoded `${OIDC_ISSUER}/.well-known/jwks` (which 404s for
      // most IdPs). discoverJwksUri fetches discovery once at startup and fails
      // closed on a non-https issuer, a cross-origin redirect, a missing/invalid
      // jwks_uri, or a jwks_uri on a different host than the issuer. jose's
      // createRemoteJWKSet then fetches the keys lazily and caches them.
      // #254: opt-in cross-origin JWKS trusted hosts (e.g. Google serves keys from
      // www.googleapis.com). Parsed fail-fast here at the composition root and
      // threaded as a parameter; empty (the default) keeps same-origin-only.
      const { jwksUri, metadata: oidcMetadata } = await discoverOidcMetadata(
        config.OIDC_ISSUER,
        config.OIDC_ALLOW_INSECURE_ISSUER,
        buildTrustedJwksHosts(config.OIDC_JWKS_TRUSTED_HOSTS),
      );
      // #346: publish the startup-validated document so the ACL's UserInfo path can
      // reuse it instead of re-fetching discovery on the authorization path with a
      // different (empty) trusted-hosts list.
      setResolvedOidcMetadata(oidcMetadata);
      // #285: serve RFC 8414 OAuth Authorization Server Metadata at this origin so
      // mcp-remote and Claude.ai's native OAuth connector can discover the IdP's
      // token_endpoint. We already serve RFC 9728 protected-resource metadata (whose
      // authorization_servers points at the IdP), but several clients resolve the
      // oauth-authorization-server well-known path against the RESOURCE server root,
      // and some IdPs (e.g. Authentik) do not expose it where those clients look.
      // The document is the IdP's own public discovery doc, fetched ONCE above (so no
      // request-path fetch and no SSRF surface) and re-served verbatim as a BARE JSON
      // object. Never emit a {jsonrpc,result} envelope on a well-known metadata path:
      // that shape is not RFC-compliant and would break client parsing (the server-info
      // probe was moved off this reserved path to /mcp-info as a bare object in #286).
      // Unauthenticated by design: a client reads this before it holds a token, so it is
      // registered here, before the bearer-auth middleware, and only when
      // AUTH_PROVIDER=oidc (this block).
      app.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.json(oidcMetadata);
      });
      const jwks = createRemoteJWKSet(new URL(jwksUri));
      const customJwtVerify = async (token: string) => {
        // Enforce the audience claim (#160, OWASP A07). Without it, any
        // signature-valid token from the trusted issuer is accepted, so a token
        // minted for a different relying party in a shared IdP tenant can be
        // replayed against this server. The accepted set is the strict allowlist
        // built above (#245: OIDC_RESOURCE plus configured extras); it is always
        // non-empty because OIDC_RESOURCE is required in OIDC mode, so the spread
        // is defensive. jose throws ERR_JWT_CLAIM_VALIDATION_FAILED on a missing
        // or out-of-set aud.
        //
        // #244: map a jose verification failure (expired, malformed, wrong aud,
        // bad signature) to MCPAuthTokenVerificationError so mcp-auth's bearer
        // handler returns a clean 401 with a WWW-Authenticate header instead of
        // re-throwing the raw jose error as a 500. Pass only the jose error as
        // the cause (never the raw token), so no token material leaks.
        let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
        try {
          ({ payload } = await jwtVerify(token, jwks, {
            issuer: config.OIDC_ISSUER,
            // Guaranteed non-empty by the startup guard above, so audience is
            // always enforced (#160/#245); never omit it.
            audience: acceptedAudiences,
          }));
        } catch (err) {
          throw new MCPAuthTokenVerificationError('invalid_token', err instanceof Error ? err : undefined);
        }
        // #244: require a usable `sub`. authenticateRequest (#163) and budget-acl
        // key authorization on req.auth.subject, so a token with no string `sub`
        // cannot be mapped to a principal. Reject it here as an invalid token (a
        // clean 401) rather than letting it through to a downstream subject check.
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          throw new MCPAuthTokenVerificationError('invalid_token');
        }
        const rawAud = payload.aud;
        const audience = Array.isArray(rawAud) ? rawAud : (rawAud ? [rawAud] : []);
        const rawScope = typeof payload.scope === 'string' ? payload.scope : '';
        return {
          token,
          // #244: populate subject from the JWT `sub` claim (guaranteed a non-empty
          // string by the check above). mcp-auth sets req.auth to exactly this
          // object, and authenticateRequest (#163) plus budget-acl.ts key off
          // req.auth.subject; without it OIDC mode rejects every request.
          subject: payload.sub,
          issuer: payload.iss ?? config.OIDC_ISSUER!,
          clientId: audience[0] ?? '',
          audience,
          scopes: rawScope ? rawScope.split(' ') : [],
          expiresAt: payload.exp,
          claims: payload as Record<string, unknown>,
        };
      };

      app.use(
        httpPath,
        mcpAuth.bearerAuth(customJwtVerify, {
          resource: config.OIDC_RESOURCE,
          // Audience (aud=clientId) is enforced inside customJwtVerify via jose's
          // jwtVerify audience option (#160), not here.
          requiredScopes,
          showErrorDetails: process.env.NODE_ENV !== 'production',
        }),
        budgetAclMiddleware as express.RequestHandler,
      );
      logger.info(`[OIDC] JWT authentication enabled. Issuer: ${config.OIDC_ISSUER}`);
    }
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const sessionInitPromises = new Map<string, Promise<void>>();  // Track session init completion
  // #438: why a session is NOT in `transports`. Closure-scoped like its two
  // siblings above, so repeated startHttpServer calls (which the unit tests make)
  // never share state and no reset export is needed. PEEK-ONLY: no reader deletes,
  // and the TTL is the sole reaper. Consume-on-read was rejected because two
  // concurrent requests on one session id would race for the single record and the
  // loser would silently get the generic 404, restoring this bug at random.
  const INIT_FAILURE_TTL_MS = 60_000;
  const INIT_FAILURE_MAX = 1000;
  const sessionInitFailures = new Map<string, { cause: InitFailureCause; sentence: string; at: number }>();
  const rememberInitFailure = (sid: string, err: unknown): void => {
    const now = Date.now();
    for (const [k, v] of sessionInitFailures) {
      if (now - v.at > INIT_FAILURE_TTL_MS) sessionInitFailures.delete(k);
    }
    // FIFO once capped. A failed init creates no pool entry, so onSessionEvicted
    // never fires for these and nothing else would ever reap them.
    while (sessionInitFailures.size >= INIT_FAILURE_MAX) {
      const oldest = sessionInitFailures.keys().next().value;
      if (oldest === undefined) break;
      sessionInitFailures.delete(oldest);
    }
    sessionInitFailures.set(sid, { ...classifyInitFailure(err), at: now });
  };
  /** Peek. Never deletes. Returns undefined once the TTL has elapsed. */
  const peekInitFailure = (sid: string): { cause: InitFailureCause; sentence: string } | undefined => {
    const rec = sessionInitFailures.get(sid);
    if (!rec) return undefined;
    if (Date.now() - rec.at > INIT_FAILURE_TTL_MS) return undefined;
    return { cause: rec.cause, sentence: rec.sentence };
  };

  // safe fallback if index didn't provide implementedTools
  const toolsList: string[] = Array.isArray(implementedTools) ? implementedTools : [];

  // #379: one resolver, one builder, for all THREE tools/list paths below: the SDK handler,
  // the no-session LobeChat compatibility path, and the expired-session LobeChat discovery
  // shim. They each assembled the payload independently, so anything added to the published
  // surface had to be added three times, and the shim was in fact missed on the first pass.
  const resolveToolMeta = (name: string) => ({
    description: actualToolsManager.getTool(name)?.description,
    schema:
      (toolSchemas && toolSchemas[name]) ||
      (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name),
  });

  // Session liveness and idle timing are owned solely by the connection pool
  // (#167). httpServer no longer runs its own idle timer or activity map; it
  // owns only the transport objects. When the pool removes a session (idle
  // sweep or explicit close) it fires this eviction listener, which tears down
  // the matching transport in the same window. This is what keeps the two
  // tables from drifting: no "alive in httpServer, dead in the pool" state, and
  // no transport object left behind for a session the client abandoned.
  connectionPool.onSessionEvicted((sessionId: string) => {
    const transport = transports.get(sessionId);
    if (transport) {
      try {
        (transport as unknown as { close?: () => void }).close?.();
      } catch (err) {
        logger.debug(`[SESSION] Error closing transport for evicted session ${sessionId} (ignoring): ${err}`);
      }
    }
    transports.delete(sessionId);
    sessionInitPromises.delete(sessionId);
    logger.info(`[SESSION] Transport torn down for evicted session: ${sessionId}`);
  });

  // Authentication middleware
  const authenticateRequest = (req: Request, res: Response): boolean => {
    // OIDC mode: verify the request principal directly rather than inferring auth
    // from configuration (#163, OWASP A07). The mcp-auth bearerAuth() middleware
    // populates req.auth.subject on a verified request; if it is absent the
    // request was NOT authenticated (middleware skipped/unmounted/null-auth), so
    // we must reject instead of trusting that "config says OIDC".
    if (config.AUTH_PROVIDER === 'oidc') {
      const subject = (req as Request & { auth?: { subject?: string } }).auth?.subject;
      if (subject) return true;
      logger.warn(`[OIDC] Rejected request with no verified principal (req.auth.subject missing) from ${req.ip || req.connection.remoteAddress}`);
      res.status(401).json({ error: 'Unauthorized: OIDC authentication required' });
      return false;
    }

    // Legacy static Bearer token mode (default).
    // If MCP_SSE_AUTHORIZATION is not configured, allow all requests
    if (!config.MCP_SSE_AUTHORIZATION) {
      return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logger.warn(`[HTTP] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Missing Authorization header`);
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
      return false;
    }

    // Check for Bearer token format
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      logger.warn(`[HTTP] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Invalid Authorization header format`);
      res.status(401).json({ error: 'Unauthorized: Invalid Authorization header format. Expected "Bearer <token>"' });
      return false;
    }

    const token = match[1];
    const expected = config.MCP_SSE_AUTHORIZATION;

    // Constant-time comparison to defeat timing oracles (#157).
    // Length-equality short-circuit precedes timingSafeEqual because the
    // function requires equal-length buffers. Token length is observable
    // via response timing regardless; the secret bytes are not.
    const tokenBuf = Buffer.from(token, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const equal =
      tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf);

    if (!equal) {
      logger.warn(`[HTTP] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Invalid token`);
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return false;
    }

    return true;
  };

  // Create a fresh Server instance per session
  function createServerInstance() {
    // ensure capabilities.tools is an object mapping tool name -> {}
    const capabilitiesObj = capabilities && Object.keys(capabilities).length
      ? capabilities
      : { tools: toolsList.reduce((acc: Record<string, object>, n: string) => { acc[n] = {}; return acc; }, {}) };

  const serverOptions: Record<string, unknown> = {
      // Provide instructions and capabilities so the SDK initialize response is correct
      instructions: serverInstructions || "Welcome to the Actual MCP server.",
      serverInstructions: { instructions: serverInstructions || "Welcome to the Actual MCP server." },
      capabilities: capabilitiesObj,
      implementedTools: toolsList,
      // Include tools array explicitly so initialize result contains tools: string[]
      tools: toolsList,
    };

    const server = new Server(
      {
        name: serverDescription || "actual-mcp-server",
        version: version || "0.1.0",
      },
      serverOptions
    );

    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('[TOOLS LIST] Listing available tools');
      logger.debug(`[TOOLS LIST] toolsList length: ${toolsList.length}`);
      const tools = buildToolListEntries(toolsList, resolveToolMeta);
      logger.debug(`[TOOLS LIST] Returning ${tools.length} tools`);
      return { tools };
    });

    // Call tool handler -> proxy to mcp.executeTool or to actualToolsManager
    // Note: sessionId is available via requestContext.getStore() for tools that need it
    server.setRequestHandler(CallToolRequestSchema, async (request: unknown) => {
      const req = request as { params?: Record<string, unknown> } | undefined;
      const params = req?.params ?? {};
      const rawName = params.name;
      const args = params.arguments;
      if (typeof rawName !== 'string') {
        throw new Error('Tool name must be a string');
      }
      const name = rawName;
      logger.debug(`[TOOL CALL] ${name} args=${JSON.stringify(args)}`);
      // Prefer ActualMCPConnection executor if provided
      if (typeof (mcp as unknown as { executeTool?: Function }).executeTool === 'function') {
        const result = await (mcp as unknown as { executeTool?: (n: string, a?: unknown) => Promise<unknown> }).executeTool!(name, args ?? {});
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
        };
      }
      // fallback: attempt actualToolsManager
      if (actualToolsManager && typeof (actualToolsManager as unknown as { invoke?: Function }).invoke === 'function') {
        const r = await (actualToolsManager as unknown as { invoke?: (n: string, a?: unknown) => Promise<unknown> }).invoke!(name, args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(r) }] };
      }
      throw new Error(`Tool executor not available for ${name}`);
    });

    return { server };
  }

  // Middleware to inject Accept header for LobeChat compatibility
  // Must be before the route handler
  app.use(httpPath, (req: Request, _res: Response, next: () => void) => {
    const accept = req.get('Accept');
    logger.debug(`[ACCEPT HEADER MIDDLEWARE] Original: ${accept || 'undefined'}`);
    // Fix Accept header if it's missing, */* , or doesn't include BOTH required types
    const needsFix = !accept || 
                     accept === '*/*' || 
                     !accept.includes('application/json') || 
                     !accept.includes('text/event-stream');
    if (needsFix) {
      logger.debug('[ACCEPT HEADER MIDDLEWARE] Modifying Accept header for MCP SDK compatibility');
      // Use setHeader to properly modify the request headers
      req.headers.accept = 'application/json, text/event-stream';
      // Also try modifying the raw headers object
      if (req.rawHeaders) {
        const acceptIndex = req.rawHeaders.findIndex((h: string) => h.toLowerCase() === 'accept');
        if (acceptIndex >= 0 && acceptIndex + 1 < req.rawHeaders.length) {
          req.rawHeaders[acceptIndex + 1] = 'application/json, text/event-stream';
        }
      }
    }
    next();
  });

  // Unified POST handler. Create new server/transport only on initialize (no session id).
  app.post(httpPath, async (req: Request, res: Response) => {
    // Authenticate the request
    if (!authenticateRequest(req, res)) {
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const payload = (req.body && Object.keys(req.body).length) ? req.body : {};
    const method = payload?.method;

    // Special handling for tools/list without session (LobeChat compatibility)
    // LobeChat sends Accept: */* or Accept: application/json which the MCP SDK rejects
    // Handle this case directly without going through the transport
    if (!sessionId && method === 'tools/list') {
      logger.debug('[LOBECHAT COMPAT] Handling tools/list without session directly');
      const tools = buildToolListEntries(toolsList, resolveToolMeta);
      
      res.json({
        jsonrpc: '2.0',
        id: payload?.id ?? null,
        result: { tools }
      });
      return;
    }

    try {
      if (!sessionId) {
        // Allow initialize or tools/list without session id (LobeChat compatibility)
        // For tools/list, we'll auto-create a session
        if (method !== 'initialize' && method !== 'tools/list') {
          res.status(400).json({
            jsonrpc: '2.0',
            id: payload?.id ?? null,
            error: { code: -32000, message: 'Missing session id; only initialize or tools/list allowed without session' },
          });
          return;
        }

        // Check if we can accept a new session (concurrent limit)
        if (!canAcceptNewSession()) {
          const state = getConnectionState();
          const stats = state.connectionPool;
          const timeoutMinutes = state.idleTimeoutMinutes || 2;
          const errorMsg = `Max concurrent sessions (${stats?.maxConcurrent}) reached. Active: ${stats?.activeSessions}. Please close existing sessions or wait for idle sessions to timeout (${timeoutMinutes} minutes).`;
          logger.warn(`[SESSION] Rejecting new session: ${errorMsg}`);
          res.status(503).json({
            jsonrpc: '2.0',
            id: payload?.id ?? null,
            error: { 
              code: -32000, 
              message: errorMsg,
              data: {
                maxConcurrent: stats?.maxConcurrent,
                activeSessions: stats?.activeSessions,
                availableSlots: (stats?.maxConcurrent ?? 0) - (stats?.activeSessions ?? 0),
                idleTimeoutMinutes: timeoutMinutes
              }
            },
          });
          return;
        }

        logger.debug('[SESSION] Creating new MCP server + transport for initialize');
        const { server } = createServerInstance();

        // Create a promise to track session initialization completion
        let resolveInit: (() => void) | undefined;
        let rejectInit: ((err: unknown) => void) | undefined;
        const initPromise = new Promise<void>((resolve, reject) => {
          resolveInit = resolve;
          rejectInit = reject;
        });
        // Always-on safety net: if no concurrent code path is awaiting initPromise
        // when rejectInit fires (e.g. session init fails before any tools/call
        // arrives), the rejection would otherwise hit process.on('unhandledRejection')
        // and exit the server. The original error is already logged inside the
        // onsessioninitialized catch block below: we deliberately do NOT re-log here
        // to avoid duplicate noise and any risk of leaking credentials.
        initPromise.catch(() => {});

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: async (sid: string) => {
            logger.debug(`Session initialized: ${sid}`);
            // Store the promise before starting initialization
            sessionInitPromises.set(sid, initPromise);
            // Initialize connection pool for this session
            try {
              await connectToActualForSession(sid);
              // Only register the transport if the pool connection succeeded.
              // The pool stamped lastActivity when it created the entry, so it
              // is already the source of truth for this session's idle clock.
              transports.set(sid, transport);
              logger.info(`[SESSION] Actual connection initialized for session: ${sid}`);
              resolveInit?.();
            } catch (err) {
              logger.error(`[SESSION] Failed to initialize Actual for session ${sid}:`, err);
              // Don't add failed sessions to transports map - they won't be usable anyway
              // This prevents accumulation of dead sessions
              // #438: remember WHY. The transport is still deliberately not registered,
              // so the dead-session protection above is unchanged; without this the
              // cause is known here and discarded, and the client's next request gets
              // a bare "Session not found" that says nothing about a schema mismatch,
              // a bad password or an unreachable server.
              rememberInitFailure(sid, err);
              rejectInit?.(err);
            } finally {
              // Clean up the promise after a short delay to allow pending requests to complete
              setTimeout(() => sessionInitPromises.delete(sid), 1000);
            }
          },
        });

        // connect transport then handle request (matching working example)
        await server.connect(transport);
        try {
          // Run in AsyncLocalStorage context so tools can access sessionId
          // and the adapter can enforce per-request budget ACL (#156).
          const allowedBudgetsInit = (req as Request & { allowedBudgets?: string[] }).allowedBudgets;
          const requestId = resolveRequestId(req.get('x-correlation-id'));
          await requestContext.run({ sessionId: undefined, requestId, allowedBudgets: allowedBudgetsInit, principal: resolvePrincipal(req) }, async () => {
            await transport.handleRequest(req, res, req.body);
          });
        } catch (err: unknown) {
          logger.error('Transport.handleRequest failed during initialize: %o', err);
          const e = err as Error | { stack?: unknown } | undefined;
          if (e && typeof e.stack === 'string') logger.error(e.stack);
          throw err;
        }
        return;
      }

      // sessionId present -> reuse. Transport presence is the liveness signal:
      // the pool's eviction listener (#167) removes the transport the moment a
      // session is genuinely evicted (idle sweep or explicit close), so a
      // missing transport means "expired" and a present one means "serve it".
      //
      // We deliberately do NOT additionally gate on connectionPool.isLive() here.
      // A pool entry can be absent while the MCP session is still perfectly
      // usable: after a transient infra error the adapter drops the pool entry
      // (without evicting the transport) so the next call re-establishes it via
      // the legacy fallback. Rejecting those requests as "expired" would force a
      // needless client re-initialize on every transient blip, re-introducing
      // the session churn this server works to avoid.
      let transport = transports.get(sessionId);
      if (!transport) {
        // Check if session is currently being initialized
        const initPromise = sessionInitPromises.get(sessionId);
        if (initPromise) {
          logger.debug(`[SESSION] Waiting for session ${sessionId} initialization to complete...`);
          try {
            // Wait for initialization to complete
            await initPromise;
            transport = transports.get(sessionId);
            if (transport) {
              logger.debug(`[SESSION] Session ${sessionId} initialization complete, proceeding with request`);
            }
          } catch (err) {
            logger.error(`[SESSION] Session ${sessionId} initialization failed:`, err);
            // Fall through to session not found handling
          }
        }
        
        if (!transport) {
          // Session doesn't exist (expired, server restarted, or invalid)
          // For tools/list, return tools for LobeChat discovery (they cache session IDs)
          // This allows LobeChat's backend to discover available tools even with expired sessions
          // #438: ONE lookup, at the top of this block and BEFORE the shim, so
          // there is a single read per request under peek semantics and a fourth
          // caller cannot reintroduce the mask. Wrapped in its own try/catch: a
          // throw here would land on the outer catch below, which returns raw
          // String(err) (that line's sanitisation is #446), and would defeat the
          // enum-only contract through the very hole left open there.
          let knownFailure: { cause: InitFailureCause; sentence: string } | undefined;
          try {
            knownFailure = peekInitFailure(sessionId);
          } catch {
            knownFailure = undefined;
          }

          if (knownFailure) {
            // A known init failure BEATS the discovery shim for this session id:
            // answering 200 plus a full tool list to a session whose connection
            // never came up is the same masking in a friendlier costume.
            logger.warn(`[SESSION] Session ${sessionId} failed to initialize (${knownFailure.cause}); reporting the cause (method: ${method})`);
            res.status(404).json({
              jsonrpc: '2.0',
              id: payload?.id ?? null,
              error: {
                code: -32001,
                // The lowercase `re-initialize` token is load bearing, not styling:
                // tests/manual/mcp-client.js:131 matches `includes('re-initialize')`
                // to trigger its session reset, and that branch is checked BEFORE its
                // `timed out` branch. Capitalising it made a failed-init session fall
                // through to the timeout branch, which retries a permanently dead
                // session until MCP_TEST_MAX_RETRIES is exhausted.
                message: `${knownFailure.sentence} Please re-initialize by calling initialize without an mcp-session-id header once the cause is fixed.`,
                // Closed enum only. Nothing derived from the upstream error reaches
                // the wire, which is why no scrubber has to be correct here.
                data: { cause: knownFailure.cause, sessionInitFailed: true },
              },
            });
            return;
          }

          if (method === 'tools/list') {
            logger.debug('[LOBECHAT COMPAT] Handling tools/list with expired/invalid session - returning tools for discovery');
            const tools = buildToolListEntries(toolsList, resolveToolMeta);
            
            res.json({
              jsonrpc: '2.0',
              id: payload?.id ?? null,
              result: { tools }
            });
            return;
          }
        
          // For other methods, reject with the MCP spec signal for a gone
          // session: HTTP 404 + JSON-RPC -32001 "Session not found". This tells a
          // spec-compliant client to start a new session (re-initialize without an
          // mcp-session-id header) instead of treating it as a generic error.
          // Previously this returned a non-spec 400 / -32000 (#188).
          logger.warn(`[SESSION] Session ${sessionId} not found (method: ${method}). Client must re-initialize.`);
          res.status(404).json({
            jsonrpc: '2.0',
            id: payload?.id ?? null,
            error: {
              code: -32001,
              message: 'Session not found. Please re-initialize by calling initialize without mcp-session-id header.'
            },
          });
          return;
        }
      }
      
      // Refresh the pool's idle clock for this session (single source of truth, #167).
      connectionPool.touch(sessionId);

      // Run in AsyncLocalStorage context so tools and the adapter can access
      // sessionId (pool branch, #134) and allowedBudgets (ACL enforcement, #156).
      const allowedBudgets = (req as Request & { allowedBudgets?: string[] }).allowedBudgets;
      const requestId = resolveRequestId(req.get('x-correlation-id'));
      await requestContext.run({ sessionId, requestId, allowedBudgets, principal: resolvePrincipal(req) }, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    } catch (err: unknown) {
      logger.error('POST handler error: %o', err);
      const e2 = err as Error | { stack?: unknown } | undefined;
      if (e2 && typeof e2.stack === 'string') logger.error(e2.stack);
      if (!res.headersSent) {
        // NOTE: this returns the raw error string to the client. That pre-existing
        // disclosure is tracked as #446 and is deliberately out of scope here. The
        // #438 session-init path above is CONTAINED by its own try/catch and never
        // reaches this line, so its closed-enum contract cannot leak through here.
        res.status(500).json({ jsonrpc: '2.0', id: payload?.id ?? null, error: { code: -32603, message: String(err) } });
      }
    }
  });

  // GET for SSE connect (reuse transport)
  app.get(httpPath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No session id' }, id: null });
      return;
    }
    connectionPool.touch(sessionId); // Refresh the pool's idle clock (#167)
    const transport = transports.get(sessionId);
    if (!transport) {
      // #438: same cause, this route's own status and code. The classifier owns no
      // status: each caller maps the classification onto the shape it already
      // returns. try/catch is load bearing here because this route has NONE and the
      // file registers no error-handling middleware, so under Express 5 an async
      // throw reaches the default final handler, which puts err.stack in the body
      // whenever NODE_ENV is not production (unset for a bare node run, and
      // `development` in docker-compose).
      // #438 REVIEW: this route is deliberately NOT given the cause. Outside the
      // OIDC branch it never calls `authenticateRequest` (POST-only, at the single
      // call site), so anything added here is reachable without an Authorization
      // header, and the sentences are configuration hints. The body therefore stays
      // the constant it has always been. The POST route, which IS authenticated,
      // carries the whole value of this feature. Reporting here can be revisited
      // once that route's auth posture is fixed, which is #447.
      //
      // The peek is kept solely for the log line: it tells an operator reading the
      // server log why this session is dead, without putting it on an unauthenticated
      // wire. try/catch is load bearing because this route has NO error handling and
      // the file registers no error middleware, so under Express 5 a throw reaches the
      // default final handler, which emits err.stack whenever NODE_ENV is not
      // production (unset for a bare node run, `development` in docker-compose).
      try {
        const knownFailure = peekInitFailure(sessionId);
        if (knownFailure) {
          logger.warn(`[SESSION] GET on session ${sessionId} whose init failed (${knownFailure.cause}); returning the generic body (auth posture, see the note above)`);
        }
      } catch {
        // never let diagnostics break the response
      }
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Transport not ready' }, id: null });
      return;
    }
    await transport.handleRequest(req, res);
  });

  // Quick GET server-info probe used by our test harness (testMcpClient.ts, the
  // Playwright E2E) to check the server is up and advertises tools before the full
  // JSON-RPC handshake. #286: this used to live on /.well-known/oauth-protected-resource
  // wrapped in a {jsonrpc,result} envelope, which squatted the RFC 9728 reserved OAuth
  // path with non-metadata (a strict OAuth client probing it got garbage). It now lives
  // on the non-reserved /mcp-info as a BARE object. The reserved OAuth path is therefore
  // unregistered in non-OIDC mode (it correctly 404s: a static-bearer server has no
  // authorization server to advertise), and in OIDC mode mcpAuth.protectedResourceMetadataRouter()
  // (registered above) still serves the compliant RFC 9728 document.
  const serverIp = process.env.MCP_BRIDGE_PUBLIC_HOST || getLocalIp();
  const mcpInfo = () => ({
    description: serverDescription || "Actual MCP server",
    instructions: serverInstructions || "Welcome to the Actual MCP server.",
    serverInstructions: { instructions: serverInstructions || "Welcome to the Actual MCP server." },
    capabilities: capabilities && Object.keys(capabilities).length ? capabilities : { tools: toolsList.reduce((a: Record<string, object>, n: string) => ({ ...a, [n]: {} }), {}) },
    tools: toolsList,
    advertisedUrl: advertisedUrl || `${scheme}://${serverIp}:${port}${httpPath}`,
  });
  app.get('/mcp-info', (_req, res) => { res.json(mcpInfo()); });
  app.get('/mcp-info/http', (_req, res) => { res.json(mcpInfo()); });

  app.get('/health', (_req, res) => {
    const state = getConnectionState();
    const poolStats = state.connectionPool || null;
    res.json({ 
      status: state.initialized ? 'ok' : 'not-initialized', 
      ...state, 
      transport: 'streamable-http', 
      activeSessions: transports.size,
      connectionPool: poolStats
    });
  });

  app.get('/metrics', async (_req, res) => {
    const txt = await observability.getMetricsText();
    if (!txt) {
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(txt);
  });

  // config validation (#169) guarantees both paths are set when HTTPS is on, so
  // the non-null assertions are safe. Wrap the reads so a missing/unreadable
  // file fails with an actionable message naming the env vars and paths instead
  // of an opaque ENOENT from readFileSync.
  let tlsOptions: { cert: Buffer; key: Buffer } | undefined;
  if (config.MCP_ENABLE_HTTPS) {
    try {
      tlsOptions = {
        cert: fs.readFileSync(config.MCP_HTTPS_CERT!),
        key: fs.readFileSync(config.MCP_HTTPS_KEY!),
      };
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to read HTTPS cert/key (MCP_ENABLE_HTTPS=true). ` +
        `MCP_HTTPS_CERT=${config.MCP_HTTPS_CERT}, MCP_HTTPS_KEY=${config.MCP_HTTPS_KEY}. Cause: ${cause}`,
      );
    }
  }

  const listener = (tlsOptions ? https.createServer(tlsOptions, app) : app).listen(port, bindHost, () => {
    const advertised = advertisedUrl || `${scheme}://${serverIp}:${port}${httpPath}`;
    // #239: when bound to a specific (non all-interfaces) host the server is NOT on
    // loopback, so point the health hint at the actual bind host instead of localhost.
    const healthHost = (!bindHost || bindHost === '0.0.0.0' || bindHost === '::') ? 'localhost' : bindHost;
    console.info(`MCP Streamable HTTP Server listening on ${port}`);
    console.info(`📨 MCP endpoint: ${advertised}`);
    console.info(`❤️ Health check: ${scheme}://${healthHost}:${port}/health`);
    if (config.AUTH_PROVIDER === 'oidc') {
      logger.info(`🔒 OIDC authentication enabled (JWT Bearer token required; issuer: ${config.OIDC_ISSUER})`);
      // #345: name the userNames the ACL can match, once, at boot. Deliberately
      // fire-and-forget INSIDE the listen callback: the server is already
      // accepting connections, so a slow or unreachable Actual delays nothing,
      // and runAclPreflight never rejects (it warns and returns).
      if (config.AUTH_BUDGET_ACL_SOURCE === 'actual') {
        void runAclPreflight();
      }
    } else if (config.MCP_SSE_AUTHORIZATION) {
      logger.info(`🔒 HTTP authentication enabled (static Bearer token required)`);
    } else {
      logger.warn(`⚠️  HTTP authentication disabled (no MCP_SSE_AUTHORIZATION or OIDC configured)`);
    }
  });

  // Configure keep-alive to maintain persistent connections
  listener.keepAliveTimeout = 65000; // 65 seconds (slightly higher than typical client timeout)
  listener.headersTimeout = 66000;   // 66 seconds (must be higher than keepAliveTimeout)
  logger.info(`⏱️  HTTP keep-alive enabled (timeout: ${listener.keepAliveTimeout}ms)`);

  // Cleanup on server shutdown
  const cleanup = async () => {
    logger.info('[SERVER] Shutting down, cleaning up sessions...');
    // Snapshot the keys: shutdownActualForSession evicts, and the eviction
    // listener deletes from `transports`, so iterating the live map would
    // mutate it mid-iteration.
    for (const sessionId of [...transports.keys()]) {
      await shutdownActualForSession(sessionId);
    }
    transports.clear();
    sessionInitPromises.clear();
    sessionInitFailures.clear(); // #438
    // Also shut down the shared/pooled connections
    await shutdownActual();
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { app, listener, cleanup };
}
