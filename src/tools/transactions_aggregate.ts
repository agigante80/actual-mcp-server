// #424: deterministic, read-only aggregation of posted transactions.
//
// Original implementation by @maxvanweenen (PR #399), requested in #398. The accounting lives in
// src/lib/financial-analysis.ts; this file is the tool surface plus the #388 filter-id resolution.

import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';
import {
  aggregateTransactions,
  type GroupDimension,
  type FinancialAnalysisSnapshot,
} from '../lib/financial-analysis.js';

const GroupDimensionSchema = z.enum(['month', 'category', 'category_group', 'payee', 'account']);

// The optional id filters are BARE strings, not CommonSchemas ids, on purpose (#388): a NAME is
// resolved to its id by adapter.resolveFilterId rather than rejected with a bare ZodError, so the
// caller learns the id. Tightening these to CommonSchemas would delete that accommodation.
const IdArray = z.array(z.string().min(1)).min(1).max(100);

const InputSchema = z.object({
  startDate: CommonSchemas.date,
  endDate: CommonSchemas.date,
  groupBy: z.union([GroupDimensionSchema, z.array(GroupDimensionSchema).min(1).max(5)]),
  accountIds: IdArray.optional(),
  categoryIds: IdArray.optional(),
  categoryGroupIds: IdArray.optional(),
  payeeIds: IdArray.optional(),
  includeIncome: z.boolean().optional().default(false),
  excludeTransfers: z.boolean().optional().default(true),
}).strict().superRefine((input, ctx) => {
  if (input.startDate > input.endDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  }
});

type AggregateToolInput = z.infer<typeof InputSchema>;

// Resolve every element of an optional id filter through the #388 chokepoint, reusing the listing
// the snapshot already fetched (so no extra listing read per element, no N+1). A well-formed known
// id passes through unchanged; a NAME throws a refusal carrying the resolved id; an unknown
// well-formed id throws NotFoundRefusal.
async function resolveIds(
  ids: string[] | undefined,
  kind: 'account' | 'category' | 'category_group' | 'payee',
  rows: { id?: string | null; name?: string | null }[],
): Promise<string[] | undefined> {
  if (!ids) return undefined;
  const resolved: string[] = [];
  for (const id of ids) {
    resolved.push(await adapter.resolveFilterId(kind, id, { verifyExists: true, rows }));
  }
  return resolved;
}

export default createTool({
  name: 'actual_transactions_aggregate',
  description: [
    'Deterministically aggregate posted transactions over an inclusive date range using integer cents.',
    'Split parents are excluded and split children are counted once.',
    'Transfers are identified only by transfer_id and never count as spending or income.',
    'Positive non-income-category transactions are credits; positive uncategorized transactions are reported separately as uncategorizedInflows.',
    'groupBy accepts one dimension or an array of month, category, category_group, payee, and account.',
    'includeIncome defaults to false. excludeTransfers defaults to true; when false, transfers stay in separate transferInflow and transferOutflow fields.',
    'Amounts are in cents: $100.00 = 10000. Dates are YYYY-MM-DD.',
  ].join(' '),
  schema: InputSchema,
  handler: async (input: AggregateToolInput) => {
    const snapshot: FinancialAnalysisSnapshot = await adapter.getFinancialAnalysisSnapshot({
      startDate: input.startDate,
      endDate: input.endDate,
    });

    const accountIds = await resolveIds(input.accountIds, 'account', snapshot.accounts);
    const categoryIds = await resolveIds(input.categoryIds, 'category', snapshot.categories);
    const categoryGroupIds = await resolveIds(input.categoryGroupIds, 'category_group', snapshot.categoryGroups);
    const payeeIds = await resolveIds(input.payeeIds, 'payee', snapshot.payees);

    const groupBy = (Array.isArray(input.groupBy) ? [...new Set(input.groupBy)] : [input.groupBy]) as GroupDimension[];

    return aggregateTransactions(snapshot, {
      startDate: input.startDate,
      endDate: input.endDate,
      groupBy,
      accountIds,
      categoryIds,
      categoryGroupIds,
      payeeIds,
      includeIncome: input.includeIncome,
      excludeTransfers: input.excludeTransfers,
    });
  },
  examples: [
    {
      description: 'Total spending per category for a month, transfers excluded',
      input: { startDate: '2025-01-01', endDate: '2025-01-31', groupBy: 'category', includeIncome: false, excludeTransfers: true },
    },
    {
      description: 'Spending and income per month, transfers kept separate',
      input: { startDate: '2025-01-01', endDate: '2025-03-31', groupBy: 'month', includeIncome: true, excludeTransfers: false },
    },
  ],
});
