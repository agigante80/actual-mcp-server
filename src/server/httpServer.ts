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
import { createMcpAuth } from '../auth/setup.js';
import { budgetAclMiddleware } from '../auth/budget-acl.js';
import * as https from 'node:https';
import * as fs from 'node:fs';

// AsyncLocalStorage for request context — moved to src/lib/requestContext.ts
// so adapter code can import it without a circular dependency on httpServer.
// Re-exported here for backward compatibility with any callers that imported
// `requestContext` from this module.
import { requestContext } from '../lib/requestContext.js';
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
  _bindHost = 'localhost',
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

      // Custom jose-based JWT verifier — bypasses mcp-auth's strict PKCE/discovery
      // validation that fails when the IdP (e.g. Casdoor v2.13) doesn't advertise
      // code_challenge_methods_supported in its discovery document.
      // JWKS is fetched lazily on the first request and cached by jose internally.
      const jwks = createRemoteJWKSet(
        new URL(`${config.OIDC_ISSUER}/.well-known/jwks`)
      );
      const customJwtVerify = async (token: string) => {
        // Enforce the audience claim (#160, OWASP A07). Without it, any
        // signature-valid token from the trusted issuer is accepted, so a token
        // minted for a different relying party in a shared IdP tenant can be
        // replayed against this server. OIDC_RESOURCE is the client-id the IdP
        // puts in `aud` (Casdoor sets aud=clientId) and is required in OIDC mode,
        // so it is always present here; the spread is defensive. jose throws
        // ERR_JWT_CLAIM_VALIDATION_FAILED on a missing or mismatched aud.
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.OIDC_ISSUER,
          ...(config.OIDC_RESOURCE ? { audience: config.OIDC_RESOURCE } : {}),
        });
        const rawAud = payload.aud;
        const audience = Array.isArray(rawAud) ? rawAud : (rawAud ? [rawAud] : []);
        const rawScope = typeof payload.scope === 'string' ? payload.scope : '';
        return {
          token,
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
      logger.info(`[OIDC] JWT authentication enabled — issuer: ${config.OIDC_ISSUER}`);
    }
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const sessionInitPromises = new Map<string, Promise<void>>();  // Track session init completion

  // safe fallback if index didn't provide implementedTools
  const toolsList: string[] = Array.isArray(implementedTools) ? implementedTools : [];

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
      const tools = toolsList.map((name: string) => {
        const schemaFromParam = toolSchemas && toolSchemas[name];
  const schemaFromManager = (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name);
        const schema = schemaFromParam || schemaFromManager;
        
        // Ensure inputSchema is a valid JSON Schema object with required properties
        const inputSchema = schema && typeof schema === 'object' && Object.keys(schema).length > 0
          ? schema
          : { type: 'object', properties: {}, additionalProperties: false };
        
        // Get the actual tool description from the tool definition
        const tool = actualToolsManager.getTool(name);
        const description = tool?.description || `Tool ${name}`;
        
        return {
          name,
          description,
          inputSchema,
        };
      });
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
      const tools = toolsList.map((name: string) => {
        const schemaFromParam = toolSchemas && toolSchemas[name];
        const schemaFromManager = (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name);
        const schema = schemaFromParam || schemaFromManager;
        
        // Ensure inputSchema is a valid JSON Schema object with required properties
        const inputSchema = schema && typeof schema === 'object' && Object.keys(schema).length > 0
          ? schema
          : { type: 'object', properties: {}, additionalProperties: false };
        
        // Get the actual tool description from the tool definition
        const tool = actualToolsManager.getTool(name);
        const description = tool?.description || `Tool ${name}`;
        
        return {
          name,
          description,
          inputSchema,
        };
      });
      
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
        // onsessioninitialized catch block below — we deliberately do NOT re-log here
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
          if (method === 'tools/list') {
            logger.debug('[LOBECHAT COMPAT] Handling tools/list with expired/invalid session - returning tools for discovery');
            const tools = toolsList.map((name: string) => {
              const schemaFromParam = toolSchemas && toolSchemas[name];
              const schemaFromManager = (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name);
              const schema = schemaFromParam || schemaFromManager;
              
              const inputSchema = schema && typeof schema === 'object' && Object.keys(schema).length > 0
                ? schema
                : { type: 'object', properties: {}, additionalProperties: false };
              
              const tool = actualToolsManager.getTool(name);
              const description = tool?.description || `Tool ${name}`;
              
              return {
                name,
                description,
                inputSchema,
              };
            });
            
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
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Transport not ready' }, id: null });
      return;
    }
    await transport.handleRequest(req, res);
  });

  // quick GET info endpoints (some clients probe)
  const serverIp = process.env.MCP_BRIDGE_PUBLIC_HOST || getLocalIp();
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      jsonrpc: '2.0',
      result: {
        description: serverDescription || "Actual MCP server",
        instructions: serverInstructions || "Welcome to the Actual MCP server.",
        serverInstructions: { instructions: serverInstructions || "Welcome to the Actual MCP server." },
        capabilities: capabilities && Object.keys(capabilities).length ? capabilities : { tools: toolsList.reduce((a: Record<string, object>, n: string) => ({ ...a, [n]: {} }), {}) },
        tools: toolsList,
        advertisedUrl: advertisedUrl || `${scheme}://${serverIp}:${port}${httpPath}`,
      },
    });
  });

  app.get('/.well-known/oauth-protected-resource/http', (_req, res) => {
    res.json({
      jsonrpc: '2.0',
      result: {
        description: serverDescription || "Actual MCP server",
        instructions: serverInstructions || "Welcome to the Actual MCP server.",
        serverInstructions: { instructions: serverInstructions || "Welcome to the Actual MCP server." },
        capabilities: capabilities && Object.keys(capabilities).length ? capabilities : { tools: toolsList.reduce((a: Record<string, object>, n: string) => ({ ...a, [n]: {} }), {}) },
        tools: toolsList,
        advertisedUrl: advertisedUrl || `${scheme}://${serverIp}:${port}${httpPath}`,
      },
    });
  });

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

  const listener = (tlsOptions ? https.createServer(tlsOptions, app) : app).listen(port, () => {
    const advertised = advertisedUrl || `${scheme}://${serverIp}:${port}${httpPath}`;
    console.info(`MCP Streamable HTTP Server listening on ${port}`);
    console.info(`📨 MCP endpoint: ${advertised}`);
    console.info(`❤️ Health check: ${scheme}://localhost:${port}/health`);
    if (config.AUTH_PROVIDER === 'oidc') {
      logger.info(`🔒 OIDC authentication enabled (JWT Bearer token required — issuer: ${config.OIDC_ISSUER})`);
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
    // Also shut down the shared/pooled connections
    await shutdownActual();
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { app, listener, cleanup };
}
