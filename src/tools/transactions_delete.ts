import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Transaction ID to delete'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_transactions_delete',
  description: 'Delete a transaction from Actual Budget. This operation cannot be undone.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteTransaction(input.id);
    return { success: true };
  },
};

export default tool;
