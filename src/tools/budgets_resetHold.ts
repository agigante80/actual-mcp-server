import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().describe('Budget month in YYYY-MM format'),
  categoryId: z.string().describe('Category ID'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_resetHold',
  description: `Reset the budget hold for a category, clearing any amount that was held for next month. This reverses the effect of holdBudgetForNextMonth and returns the budget to normal monthly behavior.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.resetBudgetHold(input.month, input.categoryId);
    return { success: true };
  },
};

export default tool;
