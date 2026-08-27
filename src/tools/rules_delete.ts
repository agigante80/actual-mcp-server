import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  // #380: the shared rule schema. The reason from #356 still holds and is why it is not
  // simply a bare string: this value is echoed into the not-found message, into the
  // schedule-owned refusal, and into logger.error, so it must be bounded. The UUID pattern
  // bounds it more tightly than the .max(64) it replaced.
  id: CommonSchemas.ruleId.describe('Rule ID to delete'),
});

/**
 * #355 fixed two defects here (a silent no-op on an unknown id, and success reported for a
 * schedule-owned rule that upstream declined to delete). #376 moved both guards into
 * `adapter.deleteRule`, which performs the read, the decision and the write in one
 * write-queue cycle.
 *
 * This tool now owns only the published schema and the response wording, which is where the
 * rest of the tool surface keeps them. Doing the guard in the adapter restores `retry` on
 * the read, keeps ONE observability call site, and leaves no unguarded `adapter.deleteRule`
 * for a future caller to reach for. See "Where a read-then-write guard belongs" in CLAUDE.md.
 */
const tool: ToolDefinition = {
  name: 'actual_rules_delete',
  description:
    'Delete a budget rule from Actual Budget. The rule will no longer be applied to new or ' +
    'existing transactions. This operation cannot be undone. A rule that belongs to a SCHEDULE ' +
    'cannot be deleted on its own: the call is refused and names the schedule tool to use instead.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteRule(input.id);
    return { success: true };
  },
};

export default tool;
