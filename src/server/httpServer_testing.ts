// src/server/httpServer_testing.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.ts';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { zodToJsonSchema } from "zod-to-json-schema";
import express, { Request, Response } from 'express';
import { Server } from './streamable-http.js';
import { StreamableHTTPServerTransport } from './streamable-http.js';
import {
  Tool,
  ToolSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from './streamable-http.js';
import logTransportWithDirection from '../logger.js';
import logger from '../logger.js';
// don't log at import time — only log when the server is actually started
// console.error('Starting Streamable HTTP server...');
 // top-level logging removed so message is not printed at import-time
// logger.info('Starting Streamable HTTP server (will be logged when startHttpServer is called)');

export async function startHttpServer(mcp: ActualMCPConnection, port: number, httpPath: string) {
  logger.info('Starting Streamable HTTP server (testing)...');
  const app = express();
  app.use(express.json());

  // Map sessionId to transport
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Tool schemas and types
  // ToolSchema isn't typed here; we'll cast request params at runtime below

  // Define tool schemas
  const HelloWorldSchema = z.object({
    name: z.string().describe("The name to greet")
  });

  const GetServerInfoSchema = z.object({});

  const LongRunningTestSchema = z.object({
    duration: z.number().optional().default(30).describe("Duration in seconds (default: 30)"),
    steps: z.number().optional().default(10).describe("Number of progress steps (default: 10)"),
    message: z.string().optional().describe("Optional message to include in the response")
  });

  const SlowTestSchema = z.object({
    message: z.string().optional().describe("Optional message to include in the response"),
    steps: z.number().optional().default(20).describe("Number of progress steps (default: 20)")
  });

  // Tool names enum
  enum ToolName {
    HELLO_WORLD = "hello_world",
    GET_SERVER_INFO = "get_server_info",
    LONG_RUNNING_TEST = "long_running_test",
    SLOW_TEST = "slow_test"
  }

  // Function to create a new MCP server instance
  function createServerInstance() {
    const server = new Server(
      {
        name: "simple-streamable-http-mcp-server",
        version: "1.0.0",
      },
      {
        instructions: "A simple test MCP server implemented with Streamable HTTP transport. Supports basic tools and long-running operations with progress updates.",
        capabilities: {
          tools: {}
        }
      }
    );

    // Set up the list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('[TOOLS LIST] Listing available tools');
       const tools: Tool[] = [
        {
          name: ToolName.HELLO_WORLD,
          description: "A simple tool that returns a greeting",
          inputSchema: zodToJsonSchema(HelloWorldSchema as any) as any,
        },
        {
          name: ToolName.GET_SERVER_INFO,
          description: "Get information about the server",
          inputSchema: zodToJsonSchema(GetServerInfoSchema as any) as any,
        },
        {
          name: ToolName.LONG_RUNNING_TEST,
          description: "A test tool that demonstrates long-running operations with progress updates",
          inputSchema: zodToJsonSchema(LongRunningTestSchema as any) as any,
        },
        {
          name: ToolName.SLOW_TEST,
          description: "A test tool that takes 10 minutes to complete and returns timing information",
          inputSchema: zodToJsonSchema(SlowTestSchema as any) as any,
        }
      ];
      
      return { tools };
    });

    // Set up the call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request: unknown, extra: unknown) => {
      const req = request as { params?: Record<string, unknown> } | undefined;
      const params = req?.params ?? {};
      const name = params.name as string | undefined;
      const args = params.arguments;
      logger.debug(`[TOOL CALL] Tool: ${name}, Args: ${JSON.stringify(args, null, 2)}`);
      debug(`Tool request details: ${JSON.stringify(params, null, 2)}`);

      if (name === ToolName.HELLO_WORLD) {
        const validatedArgs = HelloWorldSchema.parse(args);
        debug(`hello_world tool called with args:`, validatedArgs);
        await new Promise(resolve => setTimeout(resolve, 200));
        return {
          content: [{
            type: "text",
            text: `Hello, ${validatedArgs.name}! Welcome to the MCP server.`
          }]
        };
      }

      if (name === ToolName.GET_SERVER_INFO) {
        debug(`get_server_info tool called`);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name: "Simple Streamable HTTP MCP Server",
              version: "1.0.0",
              features: ["tools"],
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }

      if (name === ToolName.LONG_RUNNING_TEST) {
        const validatedArgs = LongRunningTestSchema.parse(args);
        const { duration = 30, steps = 10, message } = validatedArgs;
        const startTime = new Date();
        const startTimestamp = startTime.toISOString();
        
        debug(`long_running_test started at: ${startTimestamp}, duration: ${duration}s, steps: ${steps}`);
        
        // Get progress token if available
  const progressToken = (params as Record<string, unknown>)['_meta'] ? ((params as Record<string, any>)['_meta'] as Record<string, unknown>)?.progressToken : undefined;
        const stepDurationMs = (duration * 1000) / steps;
        
        // Send progress updates
        for (let i = 1; i <= steps; i++) {
          await new Promise(resolve => setTimeout(resolve, stepDurationMs));
          
          if (progressToken !== undefined) {
            try {
              logger.debug(`[PROGRESS] Sending progress update: ${i}/${steps} for token: ${progressToken}`);
              await server.notification({
                method: "notifications/progress",
                params: {
                  progress: i,
                  total: steps,
                  progressToken,
                },
              }, { relatedRequestId: (extra && typeof extra === 'object' && 'requestId' in (extra as Record<string, unknown>) ? (extra as Record<string, unknown>)['requestId'] as string | undefined : undefined) });
              logger.debug(`[PROGRESS] Successfully sent progress update: ${i}/${steps}`);
            } catch (error) {
              logger.error(`[PROGRESS ERROR] Failed to send progress notification: ${String(error)}`);
            }
          } else {
            debug(`No progress token provided, skipping progress update ${i}/${steps}`);
          }
        }
        
        const endTime = new Date();
        const endTimestamp = endTime.toISOString();
        const actualDurationMs = endTime.getTime() - startTime.getTime();
        
        debug(`long_running_test completed at: ${endTimestamp}`);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: message || "Long-running test completed successfully",
              start: startTimestamp,
              finish: endTimestamp,
              requestedDuration: duration,
              actualDuration: {
                milliseconds: actualDurationMs,
                seconds: actualDurationMs / 1000
              },
              steps: steps
            }, null, 2)
          }]
        };
      }

      if (name === ToolName.SLOW_TEST) {
        const validatedArgs = SlowTestSchema.parse(args);
        const { message, steps = 20 } = validatedArgs;
        const startTime = new Date();
        const startTimestamp = startTime.toISOString();
        
        debug(`slow_test tool started at: ${startTimestamp}`);
        
        // Get progress token if available
  const progressToken = (params as Record<string, unknown>)['_meta'] ? ((params as Record<string, any>)['_meta'] as Record<string, unknown>)?.progressToken : undefined;
        
        // Wait for 10 minutes (600,000 milliseconds)
        const tenMinutesMs = 10 * 60 * 1000;
        const stepDurationMs = tenMinutesMs / steps;
        
        // Send progress updates
        for (let i = 1; i <= steps; i++) {
          await new Promise(resolve => setTimeout(resolve, stepDurationMs));
          
          if (progressToken !== undefined) {
            try {
              logger.debug(`[PROGRESS] Sending progress update: ${i}/${steps} for token: ${progressToken}`);
              await server.notification({
                method: "notifications/progress",
                params: {
                  progress: i,
                  total: steps,
                  progressToken,
                },
              }, { relatedRequestId: (extra && typeof extra === 'object' && 'requestId' in (extra as Record<string, unknown>) ? (extra as Record<string, unknown>)['requestId'] as string | undefined : undefined) });
              logger.debug(`[PROGRESS] Successfully sent progress update: ${i}/${steps}`);
            } catch (error) {
              logger.error(`[PROGRESS ERROR] Failed to send progress notification: ${String(error)}`);
            }
          } else {
            debug(`No progress token provided, skipping progress update ${i}/${steps}`);
          }
          
          // Log progress every 5 steps
          if (i % 5 === 0) {
            const elapsedMinutes = (i / steps) * 10;
            logger.info(`[SLOW_TEST] Progress: ${i}/${steps} steps (${elapsedMinutes.toFixed(1)} minutes elapsed)`);
          }
        }
        
        const endTime = new Date();
        const endTimestamp = endTime.toISOString();
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = durationMs / (60 * 1000);
        
        debug(`slow_test tool completed at: ${endTimestamp}`);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: message || "Slow test completed successfully",
              start: startTimestamp,
              finish: endTimestamp,
              duration: {
                milliseconds: durationMs,
                seconds: durationMs / 1000,
                minutes: durationMinutes
              },
              steps: steps
            }, null, 2)
          }]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    });

    return { server };
  }

  // Handle POST requests
  app.post(httpPath, async (req: Request, res: Response) => {
    logger.debug('Received MCP POST request');
    logger.debug('Request method: %s', req.body?.method);
    debug('Headers:', JSON.stringify(req.headers, null, 2));
    debug('Body:', JSON.stringify(req.body, null, 2));
    
    try {
      // Check for existing session ID
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport
        transport = transports.get(sessionId)!;
        logger.debug(`[SESSION] Reusing existing transport for session ${sessionId}`);
      } else if (!sessionId) {
        // New initialization request
        logger.debug('[SESSION] Creating new server for initialization request');
        const { server } = createServerInstance();
        
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sessionId: string) => {
            transports.set(sessionId, transport);
          }
        });

        // Set up onclose handler to clean up transport when closed
        server.onclose = async () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            transports.delete(sid);
          }
        };

        // Connect the transport to the MCP server BEFORE handling the request
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return; // Already handled
      } else {
        // Invalid request - session ID provided but not found
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Invalid session ID',
          },
          id: req?.body?.id,
        });
        return;
      }

      // Handle the request with existing transport
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Error handling MCP request: %s', String(error));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: req?.body?.id,
        });
      }
    }
  });

  // Handle GET requests for SSE streams
  app.get(httpPath, async (req: Request, res: Response) => {
    logger.debug('Received MCP GET request');
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) {
      logger.debug(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
    } else {
      logger.debug(`Establishing new SSE stream for session ${sessionId}`);
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // Handle DELETE requests for session termination
  app.delete(httpPath, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    logger.debug(`Received session termination request for session ${sessionId}`);

    try {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Error handling session termination: %s', String(error));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Error handling session termination',
          },
          id: null,
        });
      }
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      server: {
        name: "simple-streamable-http-mcp-server",
        version: "1.0.0"
      },
      transport: 'streamable-http',
      activeSessions: transports.size
    });
  });

  // Start server
  app.listen(port, () => {
    logger.info(`MCP Streamable HTTP Server listening on port ${port}`);
    logger.info(`📨 MCP endpoint: http://localhost:${port}${httpPath}`);
    logger.info(`❤️  Health check: http://localhost:${port}/health`);
    logger.info(`🛠️  Available tools: hello_world, get_server_info, long_running_test, slow_test`);
  });

  // Handle server shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down server...');
 
     // Close all active transports
     for (const [sessionId, transport] of transports) {
       try {
        logger.debug(`Closing transport for session ${sessionId}`);
        await transport.close();
         transports.delete(sessionId);
       } catch (error) {
        logger.error(`Error closing transport for session ${sessionId}: ${String(error)}`);
       }
     }
 
    logger.info('Server shutdown complete');
     process.exit(0);
   });
 } 

const debug = (...args: unknown[]) => {
  if (process.env.DEBUG === 'true' || process.env.DEBUG === '1') {
    // safely stringify args to avoid implicit any spread
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    console.debug('[DEBUG]', s);
  }
};