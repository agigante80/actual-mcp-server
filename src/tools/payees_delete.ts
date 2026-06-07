import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Payee ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_payees_delete',
  description: 'Delete a payee from Actual Budget. Transactions using this payee will have it removed. This operation cannot be undone.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Route through the guarded adapter method (pre-flight existence check), not the
    // raw api.deletePayee. The raw call throws a cryptic "Cannot destructure property
    // 'transfer_acct' of null" on a non-existent id; adapter.deletePayee returns an
    // actionable "Payee not found" instead. adapter.deletePayee already runs inside a
    // single write-queue cycle, preserving the #142 lock invariant.
    await adapter.deletePayee(input.id);
    return { success: true };
  },
};

export default tool;
