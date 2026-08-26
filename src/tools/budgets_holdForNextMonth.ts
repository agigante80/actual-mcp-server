import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').describe('Budget month in YYYY-MM format'),
  // #355: upstream rejects a non-positive amount with
  // APIError('Amount to hold needs to be greater than 0') BEFORE it ever reaches
  // holdForNextMonth, so the schema rejects it here instead: same answer, no wasted
  // round trip, and the message names the field.
  amount: z.number().int().positive('amount must be greater than 0 (integer cents)')
    .describe('Amount in cents to hold for next month. Must be greater than 0.'),
});

/**
 * #355. `adapter.holdBudgetForNextMonth` reads `forNextMonth` before and after the write and
 * returns the amount ACTUALLY held, because upstream can do less than asked in two ways: it
 * holds nothing when the month has no positive To Budget, and it silently CLAMPS the hold to
 * whatever is left. A boolean catches the first and misses the second.
 *
 * #371 moved that logic into the adapter from this file. This tool owns the schema and the
 * wording of the three answers: held in full, held in part, held nothing.
 */
const tool: ToolDefinition = {
  name: 'actual_budgets_holdForNextMonth',
  description:
    "Hold an amount from this month's budget to carry into next month. The amount is in cents. " +
    'Actual can hold LESS than requested: it clamps the hold to the amount still left to budget, ' +
    'and holds nothing at all when that is zero or negative. The response reports the amount ' +
    'actually held and flags a partial hold, rather than reporting plain success.\n\n' +
    'Note: This operates on the month as a whole, not on a specific category.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const held = await adapter.holdBudgetForNextMonth(input.month, input.amount);

    if (held <= 0) {
      throw new Error(
        `Nothing was held for ${input.month}: that month has no positive amount left to budget, ` +
          'so there is nothing to carry into next month. Budget less to categories in that month, ' +
          'or check it with actual_budgets_getMonth first.',
      );
    }

    if (held < input.amount) {
      return {
        success: true as const,
        partial: true as const,
        requested: input.amount,
        held,
        message:
          `Held ${held} of the requested ${input.amount} cents for ${input.month}. Actual clamps ` +
          'the hold to the amount still left to budget in that month.',
      };
    }

    return { success: true as const, held };
  },
};

export default tool;
