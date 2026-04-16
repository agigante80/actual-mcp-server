// src/server/stdioServer.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import logger from '../logger.js';
import actualToolsManager from '../actualToolsManager.js';
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';

export async function startStdioServer(
  mcp: ActualMCPConnection,
  capabilities: Record<string, object>,
  implementedTools: string[],
  serverDescription: string,
  serverInstructions: string,
  toolSchemas: Record<string, unknown>,
  version: string,
): Promise<void> {
  const toolsList = Array.isArray(implementedTools) ? implementedTools : [];

  const server = new Server(
    { name: serverDescription || 'actual-mcp-server', version: version || '0.1.0' },
    { capabilities, instructions: serverInstructions }
  );

  // List tools handler — mirrors createServerInstance() in httpServer.ts
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = toolsList.map((name: string) => {
      const schemaFromParam = toolSchemas && toolSchemas[name];
      const schemaFromManager = (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name);
      const schema = schemaFromParam || schemaFromManager;
      const inputSchema =
        schema && typeof schema === 'object' && Object.keys(schema).length > 0
          ? schema
          : { type: 'object', properties: {}, additionalProperties: false };
      const tool = actualToolsManager.getTool(name);
      const description = tool?.description || `Tool ${name}`;
      return { name, description, inputSchema };
    });
    logger.debug(`[STDIO] tools/list → ${tools.length} tools`);
    return { tools };
  });

  // Call tool handler — delegates to ActualMCPConnection.executeTool()
  server.setRequestHandler(CallToolRequestSchema, async (request: unknown) => {
    const req = request as { params?: Record<string, unknown> } | undefined;
    const params = req?.params ?? {};
    const rawName = params.name;
    const args = params.arguments;
    if (typeof rawName !== 'string') {
      throw new Error('Tool name must be a string');
    }
    logger.debug(`[STDIO] tools/call ${rawName}`);
    const result = await (mcp as unknown as { executeTool: (n: string, a?: unknown) => Promise<unknown> }).executeTool(rawName, args ?? {});
    return {
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
    };
  });

  const transport = new StdioServerTransport();
  // server.connect() calls transport.start() internally — do NOT call transport.start() manually
  await server.connect(transport);

  // StdioServerTransport does NOT auto-exit when stdin closes.
  // Add explicit handler so Claude Desktop process cleanup works correctly.
  process.stdin.on('end', async () => {
    logger.debug('[STDIO] stdin closed — shutting down');
    await transport.close();
    process.exit(0);
  });

  logger.debug('[STDIO] Server connected and listening on stdin/stdout');
}
