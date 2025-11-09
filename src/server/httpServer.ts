// src/server/httpServer.ts
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
import { getConnectionState } from '../actualConnection.js';
import observability from '../observability.js';
import config from '../config.js';

export async function startHttpServer(
  mcp: ActualMCPConnection,
  port: number,
  httpPath: string,
  capabilities: Record<string, object>,          // was passed by index.ts
  implementedTools: string[],                    // was passed by index.ts
  serverDescription: string,                     // was passed by index.ts
  serverInstructions: string,                    // was passed by index.ts
  toolSchemas: Record<string, unknown>,              // was passed by index.ts
  bindHost = 'localhost',
  advertisedUrl?: string
) {
  const app = express();
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();

  // safe fallback if index didn't provide implementedTools
  const toolsList: string[] = Array.isArray(implementedTools) ? implementedTools : [];

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
        version: "1.0.0",
        description: serverDescription || "Actual MCP server",
      },
      serverOptions
    );

    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('[TOOLS LIST] Listing available tools');
      const tools = toolsList.map((name: string) => {
        const schemaFromParam = toolSchemas && toolSchemas[name];
  const schemaFromManager = (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name);
        const schema = schemaFromParam || schemaFromManager || {};
        return {
          name,
          description: `Tool ${name}`,
          inputSchema: schema || {},
        };
      });
      return { tools };
    });

    // Call tool handler -> proxy to mcp.executeTool or to actualToolsManager
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

        logger.debug('[SESSION] Creating new MCP server + transport for initialize');
        const { server } = createServerInstance();

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid: string) => {
            transports.set(sid, transport);
            logger.debug(`Session initialized: ${sid}`);
          },
        });

        // connect transport then handle request (matching working example)
        await server.connect(transport);
        try {
          await transport.handleRequest(req, res, req.body);
        } catch (err: unknown) {
          logger.error('Transport.handleRequest failed during initialize: %o', err);
          const e = err as Error | { stack?: unknown } | undefined;
          if (e && typeof e.stack === 'string') logger.error(e.stack);
          throw err;
        }
        return;
      }

      // sessionId present -> reuse
      let transport = transports.get(sessionId);
      if (!transport) {
        // If the client connects SSE first (rare), create a transport pinned to sessionId
        logger.debug(`[SESSION] No transport for session ${sessionId}, creating pinned transport`);
        const { server } = createServerInstance();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          enableJsonResponse: true,
          onsessioninitialized: (sid: string) => {
            transports.set(sid, transport!);
            logger.debug(`Session initialized (pinned): ${sid}`);
          },
        });
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
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
    res.json({ status: state.initialized ? 'ok' : 'not-initialized', ...state, transport: 'streamable-http', activeSessions: transports.size });
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

  return { app, listener };
}
