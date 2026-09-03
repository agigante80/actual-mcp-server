// #425: deterministic, read-only account-flow reconciliation.
//
// Original implementation by @maxvanweenen (PR #399), the "deferred secondary" tool from #398. The
// accounting lives in src/lib/financial-analysis.ts (summarizeAccountFlow); this file is the tool
// surface plus the #388 filter-id resolution.

import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';
import { summarizeAccountFlow, type FinancialAnalysisSnapshot } from '../lib/financial-analysis.js';

// Bare-string ids (#388): a NAME resolves via adapter.resolveFilterId rather than being rejected.
const InputSchema = z.object({
  startDate: CommonSchemas.date,
  endDate: CommonSchemas.date,
  accountIds: z.array(z.string().min(1)).min(1, 'Select at least one account').max(100),
}).strict().superRefine((input, ctx) => {
  if (input.startDate > input.endDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  }
});

type AccountFlowToolInput = z.infer<typeof InputSchema>;

export default createTool({
  name: 'actual_account_flow_summary',
  description: [
    'Explain the exact balance change across a selected set of accounts over an inclusive date range, in integer cents.',
    'Separates external income, expense outflow, credits, uncategorized inflows, starting-balance adjustments, and transfers into, out of, or within the selection.',
    'Transfers are detected from transfer_id and are never spending or income.',
    'openingBalance is immediately before startDate and closingBalance is at the end of the inclusive endDate; reconciliation.difference is exact and transfersByAccount names the funding counterparties.',
    'Amounts are in cents: $100.00 = 10000. Dates are YYYY-MM-DD.',
  ].join(' '),
  schema: InputSchema,
  handler: async (input: AccountFlowToolInput) => {
    // Fetch with the raw ids so the balance queries run in the same session. A NAME here filters the
    // balance query to nothing (0), which is harmless because the resolveFilterId pass below refuses
    // the name before the result is used.
    const snapshot: FinancialAnalysisSnapshot = await adapter.getFinancialAnalysisSnapshot({
      startDate: input.startDate,
      endDate: input.endDate,
      balanceAccountIds: input.accountIds,
    });
    const accountIds: string[] = [];
    for (const id of input.accountIds) {
      accountIds.push(await adapter.resolveFilterId('account', id, { verifyExists: true, rows: snapshot.accounts }));
    }
    return summarizeAccountFlow(snapshot, { startDate: input.startDate, endDate: input.endDate, accountIds });
  },
  examples: [
    {
      description: 'Reconcile the flow across two accounts for a month',
      input: { startDate: '2025-01-01', endDate: '2025-01-31', accountIds: ['<account-uuid-1>', '<account-uuid-2>'] },
    },
  ],
});
