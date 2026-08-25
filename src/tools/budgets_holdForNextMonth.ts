import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getBudgetMonth: rawGetBudgetMonth, holdBudgetForNextMonth: rawHold } = api as any;

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

/**
 * #355: report the amount actually held, not the fact that the call returned.
 *
 * There are TWO ways this operation quietly does less than asked, and a boolean only
 * catches one of them.
 *
 *   upstream holdForNextMonth:
 *     if (toBudget > 0) { await setBuffer(month, calcBufferedAmount(...)); return true; }
 *     return false;
 *
 *   calcBufferedAmount:
 *     amount = Math.min(Math.max(amount, -buffered), Math.max(toBudget, 0));
 *
 * So `false` means nothing was held, and `true` can still mean a PARTIAL hold: ask for
 * 100.00 when only 30.00 is left to budget and 30.00 is held, silently, with a `true`.
 * Reporting plain success for that is the same defect in a different costume.
 *
 * Reading `forNextMonth` (the buffered amount) before and after settles both cases from
 * observed state rather than from a return value, which is the #347 principle. Both
 * reads and the write share ONE `withWriteSession` cycle (#142).
 *
 * Cost and trade-off, recorded: two extra reads on a low-frequency budget tool, and the
 * raw-call path forgoes the adapter's retry and its observability counter, which is
 * inherent to the #142 pattern and tracked in #368.
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

    return await adapter.withWriteSession(async () => {
      const before = (await rawGetBudgetMonth(input.month)) as { forNextMonth?: number } | null;
      const heldBefore = Number(before?.forNextMonth ?? 0);

      await rawHold(input.month, input.amount);

      const after = (await rawGetBudgetMonth(input.month)) as { forNextMonth?: number } | null;
      const heldAfter = Number(after?.forNextMonth ?? 0);
      const held = heldAfter - heldBefore;

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
    });
  },
};

export default tool;
