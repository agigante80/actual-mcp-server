import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  // #361: this was a bare z.string().min(1), so 'banana' parsed and reached the API. The
  // regex matches actual_budgets_holdForNextMonth and the other month-taking tools; the
  // adapter additionally checks the month is one this budget actually has.
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format'),
  categoryId: z.string().min(1).max(64),
  amount: z.number().int('amount must be an integer (cents)'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_setAmount',
  description: "Set the budgeted amount for a specific category in a given month. Amount in cents (e.g., 50000 = $500). Use this to allocate money to spending categories for budget planning.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    try {
      const result = await adapter.setBudgetAmount(input.month, input.categoryId, input.amount);
      return { result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // The pre-flight in adapter.setBudgetAmount throws:
      //   Category "${categoryId}" not found. Use actual_categories_get to list available categories.
      // That string always contains BOTH "not found" AND "category", so && is the correct operator.
      if (msg.toLowerCase().includes('not found') && msg.toLowerCase().includes('category')) {
        return { success: false as const, error: msg };
      }
      throw new Error(`Failed to set budget amount: ${msg}`);
    }
  },
};

export default tool;
