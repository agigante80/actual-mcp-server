// src/server/stdioServer.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';
import actualToolsManager from '../actualToolsManager.js';
import { requestContext } from '../lib/requestContext.js';
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import { buildToolListEntries } from '../lib/tool-list-entry.js';
import { classifyInitFailure } from '../lib/init-failure.js';

/**
 * Build the stdio tools/call handler so its transport behavior can be tested
 * without starting a process or depending on a live Actual server.
 */
export function createStdioCallToolHandler(mcp: ActualMCPConnection, stdioSessionId: string) {
  return async (request: unknown) => {
    const req = request as { params?: Record<string, unknown> } | undefined;
    const params = req?.params ?? {};
    const rawName = params.name;
    const args = params.arguments;
    if (typeof rawName !== 'string') {
      throw new Error('Tool name must be a string');
    }
    logger.debug(`[STDIO] tools/call ${rawName}`);

    // The SDK invokes this callback from an I/O event, so establish the context
    // around the dispatch rather than around server.connect().
    const execute = () =>
      requestContext.run({ sessionId: stdioSessionId, transport: 'stdio' }, () =>
        (mcp as unknown as { executeTool: (n: string, a?: unknown) => Promise<unknown> }).executeTool(rawName, args ?? {}),
      );

    try {
      const result = await execute();
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
      };
    } catch (err) {
      const failure = classifyInitFailure(err);
      if (failure.cause === 'unknown') throw err;
      logger.warn(`[STDIO] tools/call ${rawName} failed during initialization (${failure.cause})`);
      return {
        isError: true,
        content: [{ type: 'text', text: failure.sentence }],
      };
    }
  };
}

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

  // Stdio is single-user by construction, so a process-scoped session id is
  // safe and keeps budget state isolated from HTTP sessions.
  const stdioSessionId = `stdio-${randomUUID()}`;
  logger.debug(`[STDIO] session id ${stdioSessionId}`);

  const server = new Server(
    { name: serverDescription || 'actual-mcp-server', version: version || '0.1.0' },
    { capabilities, instructions: serverInstructions },
  );

  // List tools handler mirrors createServerInstance() in httpServer.ts.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Use the same builder as HTTP so the published surface cannot drift.
    const tools = buildToolListEntries(toolsList, (name: string) => ({
      description: actualToolsManager.getTool(name)?.description,
      schema:
        (toolSchemas && toolSchemas[name]) ||
        (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name),
    }));
    logger.debug(`[STDIO] tools/list -> ${tools.length} tools`);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, createStdioCallToolHandler(mcp, stdioSessionId));

  const transport = new StdioServerTransport();
  // server.connect() calls transport.start() internally.
  await server.connect(transport);

  // StdioServerTransport does not auto-exit when stdin closes.
  process.stdin.on('end', async () => {
    logger.debug('[STDIO] stdin closed, shutting down');
    await transport.close();
    process.exit(0);
  });

  logger.debug('[STDIO] Server connected and listening on stdin/stdout');
}
