// src/server/httpServer.ts
import { AsyncLocalStorage } from 'async_hooks';
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.ts';
import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import logger from '../logger.js';
import { getLocalIp } from '../utils.js';
import actualToolsManager from '../actualToolsManager.js';
import { getConnectionState, connectToActualForSession, shutdownActualForSession, shutdownActual, canAcceptNewSession } from '../actualConnection.js';
import observability from '../observability.js';
import config from '../config.js';

// AsyncLocalStorage for request context (sessionId accessible to tools)
export const requestContext = new AsyncLocalStorage<{ sessionId?: string }>();

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
  bindHost = 'localhost',
  advertisedUrl?: string
) {
  const app = express();
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const sessionLastActivity = new Map<string, number>();
  // Use same timeout as ConnectionPool (SESSION_IDLE_TIMEOUT_MINUTES env var, default: 2 minutes)
  const idleTimeoutMinutes = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || '2', 10);
  const SESSION_TIMEOUT_MS = idleTimeoutMinutes * 60 * 1000;
  const SESSION_CLEANUP_INTERVAL_MS = 30 * 1000; // Check every 30 seconds

  // safe fallback if index didn't provide implementedTools
  const toolsList: string[] = Array.isArray(implementedTools) ? implementedTools : [];

  // Session cleanup: check for idle sessions periodically
  const cleanupInterval = setInterval(async () => {
    const now = Date.now();
    const sessionsToCleanup: string[] = [];
    
    for (const [sessionId, lastActivity] of sessionLastActivity.entries()) {
      if (now - lastActivity > SESSION_TIMEOUT_MS) {
        sessionsToCleanup.push(sessionId);
      }
    }
    
    for (const sessionId of sessionsToCleanup) {
      logger.info(`[SESSION] Cleaning up idle session: ${sessionId}`);
      transports.delete(sessionId);
      sessionLastActivity.delete(sessionId);
      await shutdownActualForSession(sessionId);
    }
  }, SESSION_CLEANUP_INTERVAL_MS);

  // Authentication middleware
  const authenticateRequest = (req: Request, res: Response): boolean => {
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
    if (token !== config.MCP_SSE_AUTHORIZATION) {
      logger.warn(`[HTTP] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Invalid token`);
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return false;
    }

    return true;
  };

  // Create a fresh Server instance similar to httpServer_testing
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
      const tools = toolsList.map((name: string) => {
        const schemaFromParam = toolSchemas && toolSchemas[name];
  const schemaFromManager = (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name);
        const schema = schemaFromParam || schemaFromManager;
        
        // Ensure inputSchema is a valid JSON Schema object with required properties
        const inputSchema = schema && typeof schema === 'object' && Object.keys(schema).length > 0
          ? schema
          : { type: 'object', properties: {}, additionalProperties: false };
        
        return {
          name,
          description: `Tool ${name}`,
          inputSchema,
        };
      });
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

  // Unified POST handler. Create new server/transport only on initialize (no session id).
  app.post(httpPath, async (req: Request, res: Response) => {
    // Authenticate the request
    if (!authenticateRequest(req, res)) {
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const payload = (req.body && Object.keys(req.body).length) ? req.body : {};
    const method = payload?.method;

    try {
      if (!sessionId) {
        // allow only initialize without session id
        if (method !== 'initialize') {
          res.status(400).json({
            jsonrpc: '2.0',
            id: payload?.id ?? null,
            error: { code: -32000, message: 'Missing session id; only initialize allowed' },
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

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: async (sid: string) => {
            logger.debug(`Session initialized: ${sid}`);
            // Initialize connection pool for this session
            try {
              await connectToActualForSession(sid);
              // Only add to transports/activity map if connection successful
              transports.set(sid, transport);
              sessionLastActivity.set(sid, Date.now());
              logger.info(`[SESSION] Actual connection initialized for session: ${sid}`);
            } catch (err) {
              logger.error(`[SESSION] Failed to initialize Actual for session ${sid}:`, err);
              // Don't add failed sessions to transports map - they won't be usable anyway
              // This prevents accumulation of dead sessions
            }
          },
        });

        // connect transport then handle request (matching working example)
        await server.connect(transport);
        try {
          // Run in AsyncLocalStorage context so tools can access sessionId
          await requestContext.run({ sessionId: undefined }, async () => {
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

      // sessionId present -> reuse
      sessionLastActivity.set(sessionId, Date.now()); // Track activity
      let transport = transports.get(sessionId);
      if (!transport) {
        // If the client connects SSE first (rare), create a transport pinned to sessionId
        logger.debug(`[SESSION] No transport for session ${sessionId}, creating pinned transport`);
        const { server } = createServerInstance();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          enableJsonResponse: true,
          onsessioninitialized: async (sid: string) => {
            transports.set(sid, transport!);
            sessionLastActivity.set(sid, Date.now());
            logger.debug(`Session initialized (pinned): ${sid}`);
            // Initialize connection pool for this session
            try {
              await connectToActualForSession(sid);
              logger.info(`[SESSION] Actual connection initialized for session: ${sid}`);
            } catch (err) {
              logger.error(`[SESSION] Failed to initialize Actual for session ${sid}:`, err);
            }
          },
        });
        await server.connect(transport);
      }

      // Run in AsyncLocalStorage context so tools can access sessionId
      await requestContext.run({ sessionId }, async () => {
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
    sessionLastActivity.set(sessionId, Date.now()); // Track activity
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
        advertisedUrl: advertisedUrl || `http://${serverIp}:${port}${httpPath}`,
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
        advertisedUrl: advertisedUrl || `http://${serverIp}:${port}${httpPath}`,
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

  const listener = app.listen(port, () => {
    const advertised = advertisedUrl || `http://${serverIp}:${port}${httpPath}`;
    console.info(`MCP Streamable HTTP Server listening on ${port}`);
    console.info(`📨 MCP endpoint: ${advertised}`);
    console.info(`❤️ Health check: http://localhost:${port}/health`);
    if (config.MCP_SSE_AUTHORIZATION) {
      logger.info(`🔒 HTTP authentication enabled (Bearer token required)`);
    } else {
      logger.warn(`⚠️  HTTP authentication disabled (no MCP_SSE_AUTHORIZATION set)`);
    }
  });

  // Configure keep-alive to maintain persistent connections
  listener.keepAliveTimeout = 65000; // 65 seconds (slightly higher than typical client timeout)
  listener.headersTimeout = 66000;   // 66 seconds (must be higher than keepAliveTimeout)
  logger.info(`⏱️  HTTP keep-alive enabled (timeout: ${listener.keepAliveTimeout}ms)`);

  // Cleanup on server shutdown
  const cleanup = async () => {
    logger.info('[SERVER] Shutting down, cleaning up sessions...');
    clearInterval(cleanupInterval);
    for (const sessionId of transports.keys()) {
      await shutdownActualForSession(sessionId);
    }
    transports.clear();
    sessionLastActivity.clear();
    // Also shut down the shared/pooled connections
    await shutdownActual();
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { app, listener, cleanup };
}
