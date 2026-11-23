// src/server/stdioServer.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';
import { attachTransportErrorLogger } from '../lib/transportErrorLogger.js';
import { SERVER_NAME } from '../lib/mcp-version.js';
import actualToolsManager from '../actualToolsManager.js';
import { requestContext } from '../lib/requestContext.js';
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import { buildToolListEntries } from '../lib/tool-list-entry.js';
import { registerPromptHandlers } from '../lib/promptHandlers.js';
import type { PromptDefinition } from '../prompts/registry.js';
import { executeToolCall, parseToolCallEnvelope } from '../lib/tool-output.js';
import { registerToolCallHandler } from '../lib/register-tool-call.js';

/**
 * The stdio `tools/call` handler, built as a named factory so #452's error mapping can be driven
 * by a unit test with a stubbed connection, instead of only by starting a real process against a
 * real server. `startStdioServer` registers exactly this.
 */
export function createStdioCallToolHandler(mcp: ActualMCPConnection, stdioSessionId: string) {
  return async (request: unknown) => {
    const req = request as { params?: Record<string, unknown> } | undefined;
    // #769: the envelope check and the error model (isError result vs -32602) are shared with
    // HTTP in tool-output.ts, so the two transports cannot drift.
    const { name: rawName, args } = parseToolCallEnvelope(req?.params);
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
    //   - `transport: 'stdio'` is what keeps stdio OFF the pooled path, and it
    //     stays that way after #419. switchBudget's slow path calls
    //     connectionPool.getConnection(), so WITHOUT this marker the first switch
    //     would silently move stdio onto the pooled branch, and the entry would
    //     never be touched (touch() is called only from httpServer.ts), so it
    //     would expire after the idle timeout and be torn down by the cleanup
    //     sweep without the api lock, possibly mid-operation. That is a far larger
    //     change than we want by accident.
    //     #419 solved the per-call upstream login WITHOUT pooling stdio: a stdio
    //     process keeps the api singleton alive between ops in shutdownActualApi
    //     (see _shouldKeepSingletonAlive), so the legacy branch's init no-ops
    //     after the first login. No pool entry is created, so there is nothing for
    //     the sweep to evict and this comment's hazard never arises.
    //   - `allowedBudgets` is absent, so under AUTH_PROVIDER=oidc switchBudget
    //     still denies. Fail closed: a local pipe must not gain budget access an
    //     HTTP caller would need an ACL for.
    //
    // #642 framing and the #769 error model both live in executeToolCall. #452: a FAILED
    // CONNECTION gets the same named causes an HTTP client gets, through `onInitFailure`, which
    // is GATED ON THE BRAND (initActualApiForOperation marks the error), never on the message:
    // the classifier's last-resort branches match prose, so a #270 op timeout would read as
    // `timeout` and a #422 rate-limit as `auth_failed`, replacing a true message with a false
    // one. The sentence is fixed and the upstream string deliberately dropped (#438): a stdio
    // tool error is handed to a cloud model, so no stack, SQL, path or server URL has to be
    // scrubbed correctly. See src/lib/init-failure.ts.
    return requestContext.run({ sessionId: stdioSessionId, transport: 'stdio' }, () =>
      executeToolCall(mcp, rawName, args, {
        onInitFailure: (cause) => {
          // stderr only: stdout is JSON-RPC framing (scripts/stdio-framing-check.mjs). The raw
          // error stays in the operator's own terminal logs; only the cause is added here.
          logger.warn('[STDIO] tool call failed while establishing the Actual connection', {
            tool: rawName,
            cause,
          });
        },
      }),
    );
  };
}

export async function startStdioServer(
  mcp: ActualMCPConnection,
  capabilities: Record<string, object>,
  implementedTools: string[],
  // #624: no longer the serverInfo name; kept so the positional signature matches HTTP.
  _serverDescription: string,
  instructions: string,
  toolSchemas: Record<string, unknown>,
  version: string,
  outputSchemas: Record<string, unknown> = {},
  // #660: resolved once in index.ts; LAST and defaulted so existing positional callers still compile.
  offeredPrompts: readonly PromptDefinition[] = [],
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
    { name: SERVER_NAME, version: version || '0.1.0' },
    { capabilities, instructions }
  );
  attachTransportErrorLogger(server, 'stdio');

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
      outputSchema: Object.hasOwn(outputSchemas, name) ? outputSchemas[name] : undefined,
    }));
    logger.debug(`[STDIO] tools/list → ${tools.length} tools`);
    return { tools };
  });

  registerPromptHandlers(server, offeredPrompts);

  // Call tool handler — delegates to ActualMCPConnection.executeTool()
  registerToolCallHandler(server, createStdioCallToolHandler(mcp, stdioSessionId));

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
