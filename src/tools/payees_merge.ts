import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  targetId: z.string().describe('ID of the target payee to merge into (this payee will be retained)'),
  mergeIds: z.array(z.string()).describe('Array of payee IDs to merge into the target payee (these will be consolidated)'),
});

const tool: ToolDefinition = {
  name: 'actual_payees_merge',
  description: `Merge one or more payees into a target payee. This consolidates duplicate payees by merging the specified payees into the target, retaining the name of the target payee. All transactions from merged payees will be reassigned to the target payee.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.mergePayees(input.targetId, input.mergeIds);
    return { success: true, message: `Successfully merged ${input.mergeIds.length} payee(s) into target payee` };
  },
};

export default tool;
