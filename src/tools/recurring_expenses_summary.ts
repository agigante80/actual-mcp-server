// #426: deterministic, read-only recurring-expense detection.
//
// Original heuristic by @maxvanweenen (PR #399), the third tool from #398. The detection lives in
// src/lib/financial-analysis.ts (summarizeRecurringExpenses); this file is the tool surface plus the
// #388 filter-id resolution. The heuristic core is ported verbatim; only the id-filter surface is
// adapted to this server's resolveFilterId convention (a NAME resolves or is refused with its id),
// matching the two sibling tools rather than PR #399's strict-UUID plus manual existence check.

import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';
import { summarizeRecurringExpenses, type FinancialAnalysisSnapshot } from '../lib/financial-analysis.js';

// Compute the inclusive start date for a "last N months" lookback, clamping the day to the target
// month's length (so a 31-day anchor lands on the last valid day) and then stepping one day forward
// so the window is a whole number of months ending at endDate.
function startFromMonths(endDate: string, months: number): string {
  const end = new Date(`${endDate}T00:00:00Z`);
  const originalDay = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDay));
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().slice(0, 10);
}

// Bare-string ids (#388): a NAME resolves via adapter.resolveFilterId rather than being rejected.
const InputSchema = z.object({
  startDate: CommonSchemas.date.optional(),
  endDate: CommonSchemas.date.optional(),
  months: z.number().int().min(1).max(60).optional(),
  accountIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  minOccurrences: z.number().int().min(2).max(100).default(3),
  includeInactive: z.boolean().default(false),
}).strict().superRefine((input, ctx) => {
  if (input.startDate && input.months) {
    ctx.addIssue({ code: 'custom', path: ['months'], message: 'Use startDate or months, not both' });
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  }
});

type RecurringToolInput = z.infer<typeof InputSchema>;

export default createTool({
  name: 'actual_recurring_expenses_summary',
  description: [
    'Detect recurring expenses (subscriptions, bills) from posted transaction history, without relying on schedules.',
    'Transfers, income, starting balances, and split-parent duplicates are excluded; a transfer is never recurring.',
    'Date drift and month-end clamping are tolerated, distinct amount lanes for one payee stay separate, and a later contiguous lane is treated as a price change with the exact new latestAmount preserved.',
    'A series that has gone quiet is inactive after a two-miss rule; includeInactive controls whether it appears.',
    'Annualized amounts use exact integer multipliers: weekly 52, biweekly 26, monthly 12, quarterly 4, yearly 1.',
    'Defaults to an 18-month lookback, three occurrences, and active series only. Amounts are in cents; dates are YYYY-MM-DD.',
  ].join(' '),
  schema: InputSchema,
  handler: async (input: RecurringToolInput) => {
    const endDate = input.endDate ?? new Date().toISOString().slice(0, 10);
    const startDate = input.startDate ?? startFromMonths(endDate, input.months ?? 18);
    // Recurring detection reads only the transaction stream and listings, no balance queries, so the
    // snapshot is fetched without balanceAccountIds. One withActualApi read session, no N+1.
    const snapshot: FinancialAnalysisSnapshot = await adapter.getFinancialAnalysisSnapshot({ startDate, endDate });
    let accountIds: string[] | undefined;
    if (input.accountIds) {
      accountIds = [];
      for (const id of input.accountIds) {
        // A NAME throws NotFoundRefusal carrying the resolved id; a well-formed id is verified against
        // the listing we already hold, so a correct call reads no extra listing.
        accountIds.push(await adapter.resolveFilterId('account', id, { verifyExists: true, rows: snapshot.accounts }));
      }
    }
    return summarizeRecurringExpenses(snapshot, {
      startDate,
      endDate,
      accountIds,
      minOccurrences: input.minOccurrences,
      includeInactive: input.includeInactive,
    });
  },
  examples: [
    {
      description: 'What am I paying for every month, over the last year',
      input: { months: 12, minOccurrences: 3, includeInactive: false },
    },
  ],
});
