import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').describe('Budget month in YYYY-MM format'),
  // #355: upstream rejects a non-positive amount with
  // APIError('Amount to hold needs to be greater than 0') BEFORE it ever reaches
  // holdForNextMonth, so the schema rejects it here instead: same answer, no wasted
  // round trip, and the message names the field. No working client can be sending a
  // value upstream already refuses.
  amount: z.number().int().positive('amount must be greater than 0 (integer cents)')
    .describe('Amount in cents to hold for next month. Must be greater than 0.'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_holdForNextMonth',
  description: `Hold an amount from this month's budget to carry into next month. The amount is in cents. This moves money from the current month's available budget into next month.

Note: This operates on the month as a whole, not on a specific category. If the month has no positive To Budget left, nothing is held and the call reports that rather than reporting success.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // #355: the adapter RETURNS the upstream verdict and it used to be discarded.
    // Upstream holds nothing and returns `false`, without throwing, when the month's
    // To Budget is not positive: there is no money left to carry forward. Reporting
    // success there was a lie (CWE-252, unchecked return value).
    //
    // Only an EXPLICIT `false` is a refusal, so a build that returns nothing (the
    // published reference documents this method as `Promise<null>`) still succeeds.
    const held = await adapter.holdBudgetForNextMonth(input.month, input.amount);
    if (held === false) {
      throw new Error(
        `Nothing was held for ${input.month}: the amount was not held because that month has ` +
          'no positive To Budget left to hold from. Budget less to categories in that month, ' +
          'or check the month with actual_budgets_getMonth first.',
      );
    }
    return { success: true };
  },
};

export default tool;
