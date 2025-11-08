import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Payee ID to delete'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_payees_delete',
  description: 'Delete a payee from Actual Budget. Transactions using this payee will have it removed. This operation cannot be undone.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deletePayee(input.id);
    return { success: true };
  },
};

export default tool;
