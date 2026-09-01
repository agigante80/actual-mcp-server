import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { summarizeAccountFlow } from '../lib/financial-analysis.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { NotFoundRefusal } from '../lib/errors.js';

const InputSchema = z.object({
  startDate: CommonSchemas.date,
  endDate: CommonSchemas.date,
  accountIds: z.array(CommonSchemas.accountId).min(1, 'Select at least one account').max(100),
}).strict().superRefine((input, context) => {
  if (input.startDate > input.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  }
});

const tool: ToolDefinition = {
  name: 'actual_account_flow_summary',
  description: [
    'Explain the exact balance change across a selected account boundary using integer cents.',
    'Separates external income, expense outflow, credits, uncategorized inflows, starting-balance adjustments, transfers into or out of the selection, and transfers within it.',
    'Transfers are detected from transfer_id and are never spending or income.',
    'openingBalance is immediately before startDate and closingBalance is at the end of inclusive endDate.',
    'reconciliation.difference is exact and transfersByAccount identifies funding counterparties.',
  ].join(' '),
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args || {});
    const snapshot = await adapter.getFinancialAnalysisSnapshot({
      startDate: input.startDate,
      endDate: input.endDate,
      balanceAccountIds: input.accountIds,
    });
    const known = new Set(snapshot.accounts.map(account => account.id));
    const missing = input.accountIds.find(id => !known.has(id));
    if (missing) throw new NotFoundRefusal('Account', missing, 'actual_accounts_list');
    return summarizeAccountFlow(snapshot, input);
  },
};

export default tool;
