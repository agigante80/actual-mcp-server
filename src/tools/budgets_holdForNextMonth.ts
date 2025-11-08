import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().describe('Budget month in YYYY-MM format'),
  categoryId: z.string().describe('Category ID'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_holdForNextMonth',
  description: `Hold the current budget amount for a category into the next month. This moves any overspending or underspending from this month to affect next month's budget. Useful for managing budget rollover beyond simple carryover.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.holdBudgetForNextMonth(input.month, input.categoryId);
    return { success: true };
  },
};

export default tool;
