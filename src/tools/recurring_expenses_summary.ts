import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { summarizeRecurringExpenses } from '../lib/financial-analysis.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { NotFoundRefusal } from '../lib/errors.js';

const InputSchema = z.object({
  startDate: CommonSchemas.date.optional(),
  endDate: CommonSchemas.date.optional(),
  months: z.number().int().min(1).max(60).optional(),
  accountIds: z.array(CommonSchemas.accountId).min(1).max(100).optional(),
  minOccurrences: z.number().int().min(2).max(100).optional().default(3),
  includeInactive: z.boolean().optional().default(false),
}).strict().superRefine((input, context) => {
  if (input.startDate && input.months) {
    context.addIssue({ code: 'custom', path: ['months'], message: 'Use startDate or months, not both' });
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  }
});

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

const tool: ToolDefinition = {
  name: 'actual_recurring_expenses_summary',
  description: [
    'Detect recurring expenses from posted transaction history without relying on schedules.',
    'Transfers, income, starting balances, and split-parent duplicates are excluded.',
    'Date drift and month-end processing are tolerated, distinct amount lanes for one payee remain separate, and a later contiguous amount lane is treated as a possible price change.',
    'Annualized amounts use exact integer multipliers: weekly 52, biweekly 26, monthly 12, quarterly 4, yearly 1.',
    'Defaults to an 18-month lookback, three occurrences, and active series only.',
  ].join(' '),
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args || {});
    const endDate = input.endDate ?? new Date().toISOString().slice(0, 10);
    const startDate = input.startDate ?? startFromMonths(endDate, input.months ?? 18);
    const snapshot = await adapter.getFinancialAnalysisSnapshot({ startDate, endDate });
    if (input.accountIds) {
      const known = new Set(snapshot.accounts.map(account => account.id));
      const missing = input.accountIds.find(id => !known.has(id));
      if (missing) throw new NotFoundRefusal('Account', missing, 'actual_accounts_list');
    }
    return summarizeRecurringExpenses(snapshot, {
      startDate,
      endDate,
      accountIds: input.accountIds,
      minOccurrences: input.minOccurrences,
      includeInactive: input.includeInactive,
    });
  },
};

export default tool;
