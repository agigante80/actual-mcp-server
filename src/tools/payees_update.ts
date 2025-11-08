import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Payee ID to update'),
  fields: z.object({
    name: z.string().optional().describe('New payee name'),
    category: z.string().optional().describe('Default category ID for this payee'),
    transfer_acct: z.string().optional().describe('Transfer account ID if this payee represents a transfer'),
  }).describe('Fields to update'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_payees_update',
  description: 'Update an existing payee in Actual Budget. You can rename the payee or change its default category.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.updatePayee(input.id, input.fields);
    return { success: true };
  },
};

export default tool;
