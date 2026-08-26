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

  // #348: a synthetic session identity for this stdio process.
  //
  // WHY THIS EXISTS. The active budget lives in a per-session map keyed on
  // sessionId (`sessionBudgetState` in actual-adapter.ts), read by
  // getActiveBudgetConfig() from requestContext. Until this, stdio never entered
  // a requestContext scope, so it had no sessionId, no slot in that map, and
  // actual_budgets_switch refused outright rather than writing somewhere nobody
  // reads. That refusal was correct: the alternative reports success while the
  // budget never changes, which is the silent-no-op class of #347.
  //
  // WHY NOT A GLOBAL. #156 removed a process-global activeBudgetKey because in
  // multi-user HTTP mode one user's switch changed the budget for everyone,
  // across ACL boundaries. Reintroducing a global "just for stdio" would put that
  // back in shared code. A per-PROCESS id is safe precisely because stdio is
  // single-user by construction: one process, one pipe, one human. Two stdio
  // processes get two ids and two slots, so nothing leaks between them.
  //
  // A uuid rather than a fixed string, so log lines are distinguishable across
  // restarts and can never collide with an HTTP session id.
  const stdioSessionId = `stdio-${randomUUID()}`;
  logger.debug(`[STDIO] session id ${stdioSessionId}`);

  const server = new Server(
    { name: serverDescription || 'actual-mcp-server', version: version || '0.1.0' },
    { capabilities, instructions: serverInstructions }
  );

  // List tools handler — mirrors createServerInstance() in httpServer.ts
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // #379: the SAME builder the HTTP paths use. stdio is the transport Claude Desktop
    // runs, and it previously assembled this payload independently, so an addition to the
    // published surface could reach HTTP clients and silently miss stdio ones.
    const tools = buildToolListEntries(toolsList, (name: string) => ({
      description: actualToolsManager.getTool(name)?.description,
      schema:
        (toolSchemas && toolSchemas[name]) ||
        (actualToolsManager as unknown as { getToolSchema?: (n: string) => unknown })?.getToolSchema?.(name),
    }));
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
    // Wrap the DISPATCH, not server.connect(). The transport invokes this handler
    // from an I/O event, which is outside any scope established around connect(),
    // so an AsyncLocalStorage context opened there would not be visible here.
    // Everything downstream is awaited inside this callback, so it propagates.
    //
    // Only `sessionId` is placed in the store, deliberately:
    //   - no `principal`, or getActiveBudgetConfig() would attempt the #189
    //     preferred-budget restore for a caller that has no authenticated
    //     identity, and the env default would stop being authoritative.
    //   - `transport: 'stdio'` is what keeps stdio OFF the pooled path.
    //     switchBudget's slow path calls connectionPool.getConnection(), so
    //     WITHOUT this marker the first switch would silently move stdio onto
    //     the pooled branch: writes would then rely on api.sync() instead of the
    //     legacy init/shutdown cycle every existing stdio persistence behaviour
    //     is built on, and the entry would never be touched (touch() is called
    //     only from httpServer.ts), so it would expire after the idle timeout and
    //     be torn down by the cleanup sweep without the api lock, possibly
    //     mid-operation. That is a far larger change than this ticket, and it is
    //     not one we want by accident.
    //   - `allowedBudgets` is absent, so under AUTH_PROVIDER=oidc switchBudget
    //     still denies. Fail closed: a local pipe must not gain budget access an
    //     HTTP caller would need an ACL for.
    const result = await requestContext.run({ sessionId: stdioSessionId, transport: 'stdio' }, () =>
      (mcp as unknown as { executeTool: (n: string, a?: unknown) => Promise<unknown> }).executeTool(rawName, args ?? {}),
    );
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
