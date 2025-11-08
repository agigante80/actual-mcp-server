import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().describe('Budget month in YYYY-MM format'),
  categoryId: z.string().describe('Category ID'),
  flag: z.boolean().describe('Whether to carry over unused budget to next month (true) or not (false)'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_setCarryover',
  description: `Set the carryover flag for a budget category in a specific month. When enabled, unused budget from this month will automatically carry over to the next month. When disabled, the budget starts fresh each month.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.setBudgetCarryover(input.month, input.categoryId, input.flag);
    return { success: true };
  },
};

export default tool;
