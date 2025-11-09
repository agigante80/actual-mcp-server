// src/server/sseServer.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.ts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { createServer } from 'http';
import type { Request, Response } from 'express';
import logger from '../logger.js';
import actualToolsManager from '../actualToolsManager.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import config from '../config.js';

export async function startSseServer(
  mcp: ActualMCPConnection,
  port: number,
  ssePath: string,
  capabilities: Record<string, object>,
  implementedTools: string[],
  serverDescription: string,
  serverInstructions: string,
  toolSchemas: Record<string, unknown>
) {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json());

  app.use((req, res, next) => {
    logger.debug(`HTTP ${req.method} ${req.originalUrl} from ${req.ip || req.connection.remoteAddress}`);
    next();
  });

  // Store transports by session ID
  const transports: Record<string, SSEServerTransport> = {};

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
      logger.warn(`[SSE] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Missing Authorization header`);
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
      return false;
    }

    // Check for Bearer token format
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      logger.warn(`[SSE] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Invalid Authorization header format`);
      res.status(401).json({ error: 'Unauthorized: Invalid Authorization header format. Expected "Bearer <token>"' });
      return false;
    }

    const token = match[1];
    if (token !== config.MCP_SSE_AUTHORIZATION) {
      logger.warn(`[SSE] Unauthorized request from ${req.ip || req.connection.remoteAddress}: Invalid token`);
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return false;
    }

    return true;
  };

  // Function to create and configure MCP server for each client
  const createMcpServer = () => {
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
        name: serverDescription || 'actual-mcp-server',
        version: '1.0.0',
        description: serverDescription || 'Actual MCP server',
      },
      serverOptions
    );

    // Set up tools/list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('[SSE] Listing available tools');
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

    // Set up tools/call handler
    server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;
      logger.debug(`[SSE] Tool call: ${name}`);
      try {
        const result = await mcp.executeTool(name, args || {});
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error(`[SSE] Tool error for ${name}:`, error);
        throw error;
      }
    });

    return server;
  };

  // SSE endpoint for establishing the stream
  app.get(ssePath, async (req: Request, res: Response) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown IP';
    
    // Authenticate the request
    if (!authenticateRequest(req, res)) {
      return;
    }
    
    logger.info(`⚡ SSE client connected from ${clientIp}`);

    try {
      // Create SSE transport - the POST endpoint will be ssePath (same path)
      const transport = new SSEServerTransport(ssePath, res);
      const sessionId = transport.sessionId;
      
      // Store the transport
      transports[sessionId] = transport;

      // Set up onclose handler
      transport.onclose = () => {
        logger.info(`❌ SSE client disconnected (session: ${sessionId}) from ${clientIp}`);
        delete transports[sessionId];
      };

      // Create and connect MCP server
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      
      logger.info(`[SSE] MCP server connected for client ${clientIp} (session: ${sessionId})`);
    } catch (error) {
      logger.error(`[SSE] Error establishing connection from ${clientIp}:`, error);
      res.status(500).end();
    }
  });

  // HEAD endpoint for checking endpoint availability
  app.head(ssePath, (req: Request, res: Response) => {
    // Authenticate the request
    if (!authenticateRequest(req, res)) {
      return;
    }
    
    // Return 200 OK with appropriate headers
    res.status(200).end();
  });

  // POST endpoint for receiving client messages
  app.post(ssePath, async (req: Request, res: Response) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown IP';
    
    // Authenticate the request
    if (!authenticateRequest(req, res)) {
      return;
    }
    
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      logger.warn(`[SSE] POST without sessionId from ${clientIp}`);
      res.status(400).json({ error: 'Missing sessionId query parameter' });
      return;
    }

    const transport = transports[sessionId];
    if (!transport) {
      logger.warn(`[SSE] POST for unknown session ${sessionId} from ${clientIp}`);
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    logger.debug(`[SSE] Received POST for session ${sessionId} from ${clientIp}`);
    
    try {
      // Let the transport handle the message
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error(`[SSE] Error handling POST message:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'sse', activeSessions: Object.keys(transports).length });
  });

  app.use((req, res) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl} from ${req.ip || req.connection.remoteAddress}`);
    res.status(404).json({ ok: false, error: 'Not Found' });
  });

  httpServer.listen(port, () => {
    logger.info(`🌐 SSE MCP server listening on http://localhost:${port}${ssePath}`);
    if (config.MCP_SSE_AUTHORIZATION) {
      logger.info(`🔒 SSE authentication enabled (Bearer token required)`);
    } else {
      logger.warn(`⚠️  SSE authentication disabled (no MCP_SSE_AUTHORIZATION set)`);
    }
  });
}