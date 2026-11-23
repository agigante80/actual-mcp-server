// src/lib/register-tool-call.ts
// #769: registers the `tools/call` handler on an SDK Server without the SDK's own validation.
// Its own file because it is the one place that must invoke a base-class method with an explicit
// receiver (`.call(`), which the single-dispatch guard in tests/unit/toolsets.test.js forbids
// everywhere but src/actualToolsManager.ts; this file is its one reviewed exemption and it
// never touches a tool.
import { z } from 'zod';
import { Protocol } from '@modelcontextprotocol/sdk/shared/protocol.js';

/**
 * The `tools/call` request schema both transports register: the method literal and nothing
 * else, so no params shape can fail before parseToolCallEnvelope sees it.
 */
const LooseCallToolRequestSchema = z.object({
  method: z.literal('tools/call'),
  params: z.looseObject({ name: z.unknown().optional(), arguments: z.unknown().optional() }).optional(),
});

/**
 * Register a `tools/call` handler on an SDK Server WITHOUT the SDK's own validation.
 *
 * WHY NOT `server.setRequestHandler(CallToolRequestSchema, ...)`. The SDK's `Server` overrides
 * `setRequestHandler` for tools/call and wraps the handler: it re-parses the request with
 * CallToolRequestSchema and on failure throws `Invalid tools/call request: <Zod dump>` before our
 * handler runs, and it validates our result against CallToolResultSchema. A loose schema alone
 * does not avoid that wrapper (probed on 1.32.2, pinned by tests/unit/tool_error_shape.test.js
 * "ASSUMPTION 1"), so this calls the base `Protocol.setRequestHandler`, public API on the
 * exported base class, which needs no private access. Consequences, accepted: no Zod dump and no
 * doubled "MCP error -32602" prefix, and the SDK no longer re-validates our result; every result
 * comes from frameToolResult or executeToolCall, which build CallToolResult shapes (the unit
 * test parses them). Tasks (`params.task`) are not supported by this server.
 */
export function registerToolCallHandler(
  server: unknown,
  handler: (request: { params?: Record<string, unknown> } | undefined) => Promise<unknown>,
): void {
  (Protocol.prototype.setRequestHandler as unknown as (this: unknown, schema: unknown, h: unknown) => void).call(
    server,
    LooseCallToolRequestSchema,
    handler,
  );
}
