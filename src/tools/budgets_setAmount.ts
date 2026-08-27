import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { isPreflightRefusal } from '../lib/errors.js';

const InputSchema = z.object({
  // #361: this was a bare z.string().min(1), so 'banana' parsed and reached the API. The
  // regex matches actual_budgets_holdForNextMonth and the other month-taking tools; the
  // adapter additionally checks the month is one this budget actually has.
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format'),
  categoryId: CommonSchemas.categoryId,
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
      // Both PRE-FLIGHT refusals from adapter.setBudgetAmount return the same structured
      // shape, so a caller can handle "you asked for something that cannot be acted on"
      // once rather than parsing two forms:
      //
      //   NotFoundRefusal    the category id does not exist               (#89)
      //   OutOfRangeRefusal  the month is outside the budget's range      (#361)
      //
      // #377: this used to ask `msg.includes('not found') && msg.includes('category')`,
      // so rewording either message in the adapter silently flipped this tool from a
      // structured refusal to a thrown error, with nothing to catch it. The decision is
      // now made by TYPE, and the message is free to change. Anything that is not a
      // refusal (a genuine upstream or transport failure) still throws.
      if (isPreflightRefusal(error)) {
        return { success: false as const, error: msg };
      }
      throw new Error(`Failed to set budget amount: ${msg}`);
    }
  },
};

export default tool;
