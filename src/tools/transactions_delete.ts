import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Transaction ID to delete'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_transactions_delete',
  description: 'Delete a transaction from Actual Budget by its ID. ' +
    'Note: if the transaction does not exist, the call will still return { success: true } ' +
    'because the Actual Budget API does not distinguish between a successful delete and a no-op. ' +
    'Use actual_transactions_filter to verify the transaction exists before deleting. ' +
    'This permanently removes the transaction and updates account balances accordingly. This operation cannot be undone.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteTransaction(input.id);
    return { success: true };
  },
};

export default tool;
