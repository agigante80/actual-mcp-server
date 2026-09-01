import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { aggregateTransactions, type GroupDimension } from '../lib/financial-analysis.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { NotFoundRefusal } from '../lib/errors.js';

const GroupDimensionSchema = z.enum(['month', 'category', 'category_group', 'payee', 'account']);

const InputSchema = z.object({
  startDate: CommonSchemas.date,
  endDate: CommonSchemas.date,
  groupBy: z.union([
    GroupDimensionSchema,
    z.array(GroupDimensionSchema).min(1).max(5),
  ]),
  accountIds: z.array(CommonSchemas.accountId).min(1).max(100).optional(),
  categoryIds: z.array(CommonSchemas.categoryId).min(1).max(100).optional(),
  categoryGroupIds: z.array(CommonSchemas.categoryGroupId).min(1).max(100).optional(),
  payeeIds: z.array(CommonSchemas.payeeId).min(1).max(100).optional(),
  includeIncome: z.boolean().optional().default(false),
  excludeTransfers: z.boolean().optional().default(true),
}).strict().superRefine((input, context) => {
  if (input.startDate > input.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  }
});

function assertKnown(
  ids: string[] | undefined,
  known: Set<string>,
  entity: string,
  listTool: string,
): void {
  const missing = ids?.find(id => !known.has(id));
  if (missing) throw new NotFoundRefusal(entity, missing, listTool);
}

const tool: ToolDefinition = {
  name: 'actual_transactions_aggregate',
  description: [
    'Deterministically aggregate posted transactions using integer cents.',
    'Split parents are excluded and split children are counted once.',
    'Transfers are identified only by transfer_id and never count as spending or income.',
    'Positive non-income-category transactions are credits; positive uncategorized transactions are reported separately as uncategorizedInflows.',
    'groupBy accepts one dimension or an array of month, category, category_group, payee, and account.',
    'includeIncome defaults to false. excludeTransfers defaults to true; when false, transfers remain separate transferInflow/transferOutflow fields.',
  ].join(' '),
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args || {});
    const snapshot = await adapter.getFinancialAnalysisSnapshot({
      startDate: input.startDate,
      endDate: input.endDate,
    });
    assertKnown(input.accountIds, new Set(snapshot.accounts.map(item => item.id)), 'Account', 'actual_accounts_list');
    assertKnown(input.categoryIds, new Set(snapshot.categories.map(item => item.id)), 'Category', 'actual_categories_get');
    assertKnown(input.categoryGroupIds, new Set(snapshot.categoryGroups.map(item => item.id)), 'Category group', 'actual_category_groups_get');
    assertKnown(input.payeeIds, new Set(snapshot.payees.map(item => item.id)), 'Payee', 'actual_payees_get');
    return aggregateTransactions(snapshot, {
      ...input,
      groupBy: (Array.isArray(input.groupBy) ? [...new Set(input.groupBy)] : [input.groupBy]) as GroupDimension[],
    });
  },
};

export default tool;
