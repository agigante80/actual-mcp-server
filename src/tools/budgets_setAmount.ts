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
  description:
    'Set the budgeted amount for a specific category in a given month. Amount in cents ' +
    '(e.g., 50000 = $500). Use this to allocate money to spending categories for budget planning. ' +
    'The month must be one the budget actually has: Actual allows from three months before the ' +
    'earliest transaction to twelve months ahead. Use actual_budgets_getMonths to see the range.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    try {
      const result = await adapter.setBudgetAmount(input.month, input.categoryId, input.amount);
      return { result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lower = msg.toLowerCase();
      // Both PRE-FLIGHT refusals from adapter.setBudgetAmount return the same structured
      // shape, so a caller can handle "you asked for something that does not exist" once
      // rather than parsing two forms:
      //
      //   Category "<id>" not found. Use actual_categories_get ...            (#89)
      //   Month "<month>" is not in this budget. It runs from X to Y ...      (#361)
      //
      // #361 added the second one, and before this it fell through to the rethrow below,
      // so one tool answered two identical situations in two different shapes. Anything
      // else (a genuine upstream or transport failure) still throws.
      const isCategoryRefusal = lower.includes('not found') && lower.includes('category');
      const isMonthRefusal = lower.includes('not in this budget');
      if (isCategoryRefusal || isMonthRefusal) {
        return { success: false as const, error: msg };
      }
      throw new Error(`Failed to set budget amount: ${msg}`);
    }
  },
};

export default tool;
