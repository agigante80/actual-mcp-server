// src/server/httpServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import express, { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  Tool,
  ToolSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import { logTransport, getLocalIp } from '../utils.js';
import actualToolsManager from '../actualToolsManager.js'; // add near other imports

export async function startHttpServer(
  mcp: ActualMCPConnection,
  port: number,
  httpPath: string,
  capabilities: Record<string, object>, // already { tools: {} }
  implementedTools: string[],
  serverDescription: string,
  serverInstructions: string,
  toolSchemas: Record<string, any>, // JSON schemas from ActualToolsManager
  bindHost = 'localhost', // host to bind the Express server (e.g. 0.0.0.0)
  advertisedUrl?: string // human-friendly URL to advertise to clients
) {
  const app = express();
  app.use(express.json());

  const serverIp = process.env.MCP_BRIDGE_PUBLIC_HOST || getLocalIp();
  const withServer = (prefix: string, obj: unknown) => logTransport(`${prefix} [server:${serverIp}]`, obj);

  // helper to send SSE framed message and log it
  function sendSSE(res: Response, event: string | null, data: unknown) {
    const payload = event ? `event: ${event}\n` : '';
    // JSON stringify here to ensure consistent log format
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    withServer('SSE OUT', { event, body });
    // SSE framing
    res.write(`${payload}data: ${body}\n\n`);
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();

  function debug(...args: unknown[]) {
    if (process.env.DEBUG === 'true') console.debug('[DEBUG]', ...args);
  }

  function createServerInstance() {
    // Clone capabilities and add tools as objects
    const mcpCapabilities: Record<string, object> = { ...capabilities };
    mcpCapabilities.tools = implementedTools.reduce((acc, toolName) => {
      acc[toolName] = {}; // MCP expects each tool as an object
      return acc;
    }, {} as Record<string, object>);

    // NOTE: Move `instructions` to second argument as required
    const server = new Server(
      {
        name: 'actual-mcp-server',
        version: '1.0.0',
        description: serverDescription, // Remains here
      },
      {
        instructions: serverInstructions,  // <-- MUST be in second arg
        capabilities: mcpCapabilities,    // tools and other capabilities here
      }
    );

    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      debug('Listing available tools');
      const tools: Tool[] = implementedTools.map((toolName) => ({
        name: toolName,
        description: `Tool named ${toolName}`,
        inputSchema: toolSchemas[toolName] || ToolSchema,
      }));
      return { tools };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      debug(`Tool call: ${name}`, args);
      try {
        const result = await mcp.executeTool(name, args);
        return result;
      } catch (error) {
        console.error(`Error executing tool ${name}:`, error);
        throw error;
      }
    });

    return { server };
  }

  // Create a single server instance (reuse across transports) to avoid races
  const { server } = createServerInstance();
  const pendingTransports = new Map<string, Promise<StreamableHTTPServerTransport>>();

  // POST MCP handler
  app.post(httpPath, async (req: Request, res: Response) => {
    withServer('HTTP REQ', {
      type: 'request',
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
    });

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const body = req.body ?? {};

      // Quick-path: respond to tools/call directly so callers receive a JSON-RPC reply
      if (body?.method === 'tools/call' && body?.params?.name) {
        const callId = body.id ?? null;
        const toolName = String(body.params.name);
        const args = body.params.arguments ?? {};

        // Ensure session exists (tools/call requires active session)
        if (!sessionId || !transports.has(sessionId)) {
          res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: callId });
          return;
        }

        debug(`Direct tool call (quick-path): ${toolName}`, args);
        const transport = transports.get(sessionId)!;

        // Directly handle the request with the transport
        await transport.handleRequest(req, res, body);
        return;
      }

      // If this is an initialization request (no sessionId) create a new transport,
      // connect it and let the transport write the initialization response, then return.
      if (!sessionId) {
        // create a new transport for this initialization request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid: string) => {
            transports.set(sid, transport);
            debug(`Session initialized: ${sid}`);
          },
        });

        // connect transport to the shared server instance
        await server.connect(transport);

        // Let the transport handle the request and return immediately.
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Otherwise, try to reuse an existing transport for this session
      if (!transports.has(sessionId)) {
        // No transport found for provided sessionId -> bad request
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: req?.body?.id ?? null });
        return;
      }

      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);

      // Do not write fallback JSON here — transport is responsible for the response.
    } catch (err: any) {
      withServer('HTTP ERR', {
        type: 'error',
        message: err?.message ?? String(err),
        stack: err?.stack,
      });
      if (!res.headersSent) {
        res.status(err?.status || 500).json({ error: err?.message || String(err) });
      }
    }
  });

  // GET MCP handler (for SSE)
  app.get(httpPath, async (req: Request, res: Response) => {
    withServer('HTTP CONNECT', {
      type: 'sse_connect',
      method: req.method,
      path: req.path,
      headers: req.headers,
      query: req.query,
    });

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: null });
        return;
      }

      // If we don't yet have a transport for this session, create one bound to the
      // provided session id so the SSE client can connect.
      if (!transports.has(sessionId)) {
        // Avoid races: if another request is already creating this transport, wait for it.
        if (pendingTransports.has(sessionId)) {
          const transport = await pendingTransports.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }

        const createPromise = (async () => {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId, // force this transport to use the requested id
            enableJsonResponse: true,
            onsessioninitialized: (sid: string) => {
              transports.set(sid, transport);
              debug(`Session initialized (GET fallback): ${sid}`);
            },
          });
          await server.connect(transport);
          return transport;
        })();

        pendingTransports.set(sessionId, createPromise);
        try {
          const transport = await createPromise;
          pendingTransports.delete(sessionId);
          await transport.handleRequest(req, res);
          return;
        } catch (e) {
          pendingTransports.delete(sessionId);
          throw e;
        }
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Transport not ready' }, id: null });
        return;
      }
      await transport.handleRequest(req, res);
    } catch (err: any) {
      withServer('HTTP ERR', {
        type: 'error',
        message: err?.message ?? String(err),
        stack: err?.stack,
      });
      if (!res.headersSent) {
        res.status(err?.status || 500).json({ error: err?.message || String(err) });
      }
    }
  });

  // Start HTTP server
  const listener = app.listen(port, bindHost, () => {
    const advertised = advertisedUrl ?? `http://${serverIp}:${port}${httpPath}`;
    console.info(`MCP Streamable HTTP Server listening on ${bindHost}:${port}`);
    console.info(`📨 MCP endpoint: ${advertised}`);
    console.info(`❤️ Health check: http://${bindHost}:${port}/health`);
  });

  return { app, listener };
}
