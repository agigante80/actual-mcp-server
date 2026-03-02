import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').describe('Budget month in YYYY-MM format'),
  amount: z.number().int().describe('Amount in cents to hold for next month'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_holdForNextMonth',
  description: `Hold an amount from this month's budget to carry into next month. The amount is in cents. This moves money from the current month's available budget into next month.

Note: This operates on the month as a whole, not on a specific category.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.holdBudgetForNextMonth(input.month, input.amount);
    return { success: true };
  },
};

export default tool;
