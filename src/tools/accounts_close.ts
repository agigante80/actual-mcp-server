import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Account ID to close'),
});

const tool: ToolDefinition = {
  name: 'actual_accounts_close',
  description: `Mark an account as closed in Actual Budget. Closed accounts are hidden from most views but their transaction history is preserved. Useful for accounts that are no longer active but you want to keep the historical data.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.closeAccount(input.id);
    return { success: true };
  },
};

export default tool;
