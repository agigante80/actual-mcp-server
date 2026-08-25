import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// #356: bounded on both axes. The ids are echoed back in error messages and into the
// structured logs, so an unbounded string or array is an unbounded echo. Actual's ids
// are UUIDs, so 64 characters is already generous, and no legitimate merge consolidates
// more than a few hundred payees in one call.
const PayeeIdSchema = z.string().min(1).max(64);

const InputSchema = z.object({
  targetId: PayeeIdSchema.describe('ID of the target payee to merge into (this payee will be retained)'),
  mergeIds: z.array(PayeeIdSchema).min(1).max(50)
    .describe('Array of payee IDs to merge into the target payee (these will be consolidated)'),
});

const tool: ToolDefinition = {
  name: 'actual_payees_merge',
  description:
    'Merge one or more payees into a target payee. This consolidates duplicate payees by merging ' +
    'the specified payees into the target, retaining the name of the target payee. All transactions ' +
    'from merged payees are reassigned to the target. TRANSFER payees (the payee Actual creates for ' +
    'each account) cannot be merged in either direction: such a merge is refused rather than ' +
    'silently ignored. The response lists the ids that were actually merged.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // #356: report what HAPPENED, not what was asked for. The old message counted
    // `input.mergeIds.length`, which is a statement about the caller's input: it said
    // "merged 3 payees" even when Actual had silently dropped every one of them for
    // being a transfer payee. The adapter now refuses that case outright and returns
    // the ids it actually merged.
    const merged = await adapter.mergePayees(input.targetId, input.mergeIds);
    const mergedIds = Array.isArray(merged) ? merged : input.mergeIds;
    // #356: `mergedIds` carries the full list for a caller that wants it; the human
    // readable message names at most five, because up to 200 ids at 64 characters each
    // is an unbounded echo into the response and the logs.
    const shown = mergedIds.slice(0, 5).join(', ');
    const rest = mergedIds.length - Math.min(mergedIds.length, 5);
    return {
      success: true,
      mergedIds,
      message:
        `Merged ${mergedIds.length} payee(s) into ${input.targetId}: ${shown}` +
        (rest > 0 ? ` (and ${rest} more)` : ''),
    };
  },
};

export default tool;
