import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Account ID to reopen'),
});

const tool: ToolDefinition = {
  name: 'actual_accounts_reopen',
  description: `Reopen a previously closed account in Actual Budget. The account will become active again and visible in all views. All historical transactions remain intact.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.reopenAccount(input.id);
    return { success: true };
  },
};

export default tool;
