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

export async function startHttpServer(
  mcp: ActualMCPConnection,
  port: number,
  httpPath: string,
  capabilities: Record<string, object>, // already { tools: {} }
  implementedTools: string[],
  serverDescription: string,
  serverInstructions: string,
  toolSchemas: Record<string, any> // JSON schemas from ActualToolsManager
) {
  const app = express();
  app.use(express.json());

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

  // POST MCP handler
  app.post(httpPath, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else {
        const { server } = createServerInstance();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid: string) => {
            transports.set(sid, transport);
            debug(`Session initialized: ${sid}`);
          },
        });
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling POST MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: req.body?.id });
      }
    }
  });

  // GET MCP handler (for SSE)
  app.get(httpPath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: null });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // DELETE session
  app.delete(httpPath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session ID' }, id: null });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    transports.delete(sessionId);
    debug(`Session ${sessionId} deleted`);
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', activeSessions: transports.size });
  });

  // Start server
  app.listen(port, () => {
    console.log(`MCP Streamable HTTP Server listening on port ${port}`);
    console.log(`📨 MCP endpoint: http://localhost:${port}${httpPath}`);
    console.log(`❤️ Health check: http://localhost:${port}/health`);
  });

  process.on('SIGINT', async () => {
    console.error('Shutting down server...');
    for (const [sid, transport] of transports) {
      try { await transport.close(); } catch (err) { console.error(`Error closing transport ${sid}:`, err); }
      transports.delete(sid);
    }
    console.error('Server shutdown complete');
    process.exit(0);
  });
}
