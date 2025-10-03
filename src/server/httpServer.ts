// src/server/httpServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import logger from '../logger.js';
import { getLocalIp } from '../utils.js';
import actualToolsManager from '../actualToolsManager.js';

export async function startHttpServer(
  mcp: ActualMCPConnection,
  port: number,
  httpPath: string,
  capabilities: Record<string, object>,          // was passed by index.ts
  implementedTools: string[],                    // was passed by index.ts
  serverDescription: string,                     // was passed by index.ts
  serverInstructions: string,                    // was passed by index.ts
  toolSchemas: Record<string, any>,              // was passed by index.ts
  bindHost = 'localhost',
  advertisedUrl?: string
) {
  const app = express();
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();

  // safe fallback if index didn't provide implementedTools
  const toolsList: string[] = Array.isArray(implementedTools) ? implementedTools : [];

  // Create a fresh Server instance similar to httpServer_testing
  function createServerInstance() {
    const serverOptions: any = {
      // Provide instructions and capabilities so the SDK initialize response is correct
      instructions: serverInstructions || "Welcome to the Actual MCP server.",
      serverInstructions: { instructions: serverInstructions || "Welcome to the Actual MCP server." },
      capabilities: capabilities && Object.keys(capabilities).length ? capabilities : { tools: {} },
      implementedTools: toolsList,
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
        const schemaFromManager = (actualToolsManager as any)?.getToolSchema?.(name);
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
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params as any;
      logger.debug(`[TOOL CALL] ${name} args=${JSON.stringify(args)}`);
      // Prefer ActualMCPConnection executor if provided
      if (typeof (mcp as any).executeTool === 'function') {
        const result = await (mcp as any).executeTool(name, args ?? {});
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
        };
      }
      // fallback: attempt actualToolsManager
      if (actualToolsManager && typeof (actualToolsManager as any).invoke === 'function') {
        const r = await (actualToolsManager as any).invoke(name, args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(r) }] };
      }
      throw new Error(`Tool executor not available for ${name}`);
    });

    return { server };
  }

  // Unified POST handler. Create new server/transport only on initialize (no session id).
  app.post(httpPath, async (req: Request, res: Response) => {
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
        await transport.handleRequest(req, res, req.body);
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
    } catch (err: any) {
      logger.error('POST handler error', String(err));
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
    res.json({ status: 'ok', transport: 'streamable-http', activeSessions: transports.size });
  });

  const listener = app.listen(port, () => {
    const advertised = advertisedUrl || `http://${serverIp}:${port}${httpPath}`;
    console.info(`MCP Streamable HTTP Server listening on ${port}`);
    console.info(`📨 MCP endpoint: ${advertised}`);
    console.info(`❤️ Health check: http://localhost:${port}/health`);
  });

  return { app, listener };
}
