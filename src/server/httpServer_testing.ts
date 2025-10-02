// src/server/httpServer_testing.ts
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { zodToJsonSchema } from "zod-to-json-schema";
import express, { Request, Response } from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  Tool,
  ToolSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import logTransportWithDirection from '../logger.js';
import logger from '../logger.js';

console.error('Starting Streamable HTTP server...');

export async function startHttpServer(mcp: ActualMCPConnection, port: number, httpPath: string) {
  const app = express();
  app.use(express.json());

  // Map sessionId to transport
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Tool schemas and types
  const ToolInputSchema = ToolSchema.shape.inputSchema;
  type ToolInput = z.infer<typeof ToolInputSchema>;

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
      console.error('[TOOLS LIST] Listing available tools');
      const tools: Tool[] = [
        {
          name: ToolName.HELLO_WORLD,
          description: "A simple tool that returns a greeting",
          inputSchema: zodToJsonSchema(HelloWorldSchema) as ToolInput,
        },
        {
          name: ToolName.GET_SERVER_INFO,
          description: "Get information about the server",
          inputSchema: zodToJsonSchema(GetServerInfoSchema) as ToolInput,
        },
        {
          name: ToolName.LONG_RUNNING_TEST,
          description: "A test tool that demonstrates long-running operations with progress updates",
          inputSchema: zodToJsonSchema(LongRunningTestSchema) as ToolInput,
        },
        {
          name: ToolName.SLOW_TEST,
          description: "A test tool that takes 10 minutes to complete and returns timing information",
          inputSchema: zodToJsonSchema(SlowTestSchema) as ToolInput,
        }
      ];
      
      return { tools };
    });

    // Set up the call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;
      console.error(`[TOOL CALL] Tool: ${name}, Args:`, JSON.stringify(args, null, 2));
      debug(`Tool request details:`, JSON.stringify(request.params, null, 2));

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
        const progressToken = request.params._meta?.progressToken;
        const stepDurationMs = (duration * 1000) / steps;
        
        // Send progress updates
        for (let i = 1; i <= steps; i++) {
          await new Promise(resolve => setTimeout(resolve, stepDurationMs));
          
          if (progressToken !== undefined) {
            try {
              console.error(`[PROGRESS] Sending progress update: ${i}/${steps} for token: ${progressToken}`);
              await server.notification({
                method: "notifications/progress",
                params: {
                  progress: i,
                  total: steps,
                  progressToken,
                },
              }, { relatedRequestId: extra.requestId });
              console.error(`[PROGRESS] Successfully sent progress update: ${i}/${steps}`);
            } catch (error) {
              console.error(`[PROGRESS ERROR] Failed to send progress notification:`, error);
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
        const progressToken = request.params._meta?.progressToken;
        
        // Wait for 10 minutes (600,000 milliseconds)
        const tenMinutesMs = 10 * 60 * 1000;
        const stepDurationMs = tenMinutesMs / steps;
        
        // Send progress updates
        for (let i = 1; i <= steps; i++) {
          await new Promise(resolve => setTimeout(resolve, stepDurationMs));
          
          if (progressToken !== undefined) {
            try {
              console.error(`[PROGRESS] Sending progress update: ${i}/${steps} for token: ${progressToken}`);
              await server.notification({
                method: "notifications/progress",
                params: {
                  progress: i,
                  total: steps,
                  progressToken,
                },
              }, { relatedRequestId: extra.requestId });
              console.error(`[PROGRESS] Successfully sent progress update: ${i}/${steps}`);
            } catch (error) {
              console.error(`[PROGRESS ERROR] Failed to send progress notification:`, error);
            }
          } else {
            debug(`No progress token provided, skipping progress update ${i}/${steps}`);
          }
          
          // Log progress every 5 steps
          if (i % 5 === 0) {
            const elapsedMinutes = (i / steps) * 10;
            console.error(`[SLOW_TEST] Progress: ${i}/${steps} steps (${elapsedMinutes.toFixed(1)} minutes elapsed)`);
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
    console.error('Received MCP POST request');
    console.error('Request method:', req.body?.method);
    debug('Headers:', JSON.stringify(req.headers, null, 2));
    debug('Body:', JSON.stringify(req.body, null, 2));
    
    try {
      // Check for existing session ID
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport
        transport = transports.get(sessionId)!;
        console.error(`[SESSION] Reusing existing transport for session ${sessionId}`);
      } else if (!sessionId) {
        // New initialization request
        console.error('[SESSION] Creating new server for initialization request');
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
      console.error('Error handling MCP request:', error);
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
    console.error('Received MCP GET request');
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
      console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
    } else {
      console.error(`Establishing new SSE stream for session ${sessionId}`);
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

    console.error(`Received session termination request for session ${sessionId}`);

    try {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling session termination:', error);
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
    console.error(`MCP Streamable HTTP Server listening on port ${port}`);
    console.log(`📨 MCP endpoint: http://localhost:${port}${httpPath}`);
    console.log(`❤️  Health check: http://localhost:${port}/health`);
    console.log(`🛠️  Available tools: hello_world, get_server_info, long_running_test, slow_test`);
  });

  // Handle server shutdown
  process.on('SIGINT', async () => {
    console.error('Shutting down server...');

    // Close all active transports
    for (const [sessionId, transport] of transports) {
      try {
        console.error(`Closing transport for session ${sessionId}`);
        await transport.close();
        transports.delete(sessionId);
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }

    console.error('Server shutdown complete');
    process.exit(0);
  });
}

const debug = (...args: any[]) => {
  if (process.env.DEBUG === 'true' || process.env.DEBUG === '1') {
    console.debug('[DEBUG]', ...args);
  }
};