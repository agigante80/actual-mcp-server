/**
 * actual_transactions_uncategorized
 *
 * Returns a summary of uncategorized transactions by default (totalCount, totalAmount,
 * per-account breakdown). Pass includeTransactions:true to also receive a paginated
 * transaction list with limit/offset/hasMore.
 *
 * Concept and implementation adapted from the ZanzyTHEbar fork:
 * https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/transactions_uncategorized.ts
 * Credit: ZanzyTHEbar (https://github.com/ZanzyTHEbar)
 */
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  startDate: CommonSchemas.date.optional().describe('Start date in YYYY-MM-DD format (default: all-time)'),
  endDate: CommonSchemas.date.optional().describe('End date in YYYY-MM-DD format (default: today)'),
  accountId: CommonSchemas.accountId.optional().describe('Filter to a specific account ID (optional)'),
  includeTransactions: z.boolean().optional().default(false).describe('When true, include paginated transaction rows in the response (default: false)'),
  limit: z.number().int().min(1).max(1000).optional().default(50).describe('Max transactions per page when includeTransactions is true (default: 50, max: 1000)'),
  offset: z.number().int().min(0).optional().default(0).describe('Pagination start index when includeTransactions is true (default: 0)'),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isUncategorized(txn: any, excludedAccountIds: Set<string>): boolean {
  return (
    txn?.category == null &&
    txn?.transfer_id == null &&
    txn?.is_parent !== true &&
    txn?.starting_balance_flag !== true &&
    !excludedAccountIds.has(txn?.account)
  );
}

const tool: ToolDefinition = {
  name: 'actual_transactions_uncategorized',
  description: [
    'Get uncategorized transactions summary and optional paginated list.',
    'Default response: { totalCount, totalAmount, byAccount: [{accountId, accountName, count, totalAmount}], dateRange }.',
    'Pass includeTransactions:true to also receive transactions[], count, hasMore, offset, limit.',
    'Use limit (default 50, max 1000) and offset for pagination.',
    'Excludes: transfers, split-transaction parents, opening balance entries, off-budget accounts, and closed accounts.',
    'When accountId is provided, all fields are scoped to that account.',
    'Default date range is all-time (2000-01-01 to today); pass startDate/endDate to narrow.',
    'Note: the legacy summary.totalAmount field has been removed — totalAmount is now at the top level.',
  ].join(' '),
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    const today = new Date();
    const startDate = input.startDate || '2000-01-01';
    const endDate = input.endDate || today.toISOString().split('T')[0];
    const accountId = input.accountId ?? undefined;

    // Full table scan when no accountId — reliably returns newly written transactions
    // across separate WAL sessions in CI Docker. Filtering by accountId uses an index
    // that can lag across sessions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txnRaw = await adapter.getTransactions(accountId as any, startDate, endDate);
    const txns = Array.isArray(txnRaw) ? txnRaw : [];

    // Fetch accounts for exclusion set (off-budget + closed) and name lookup.
    // Two separate withActualApi sessions is intentional for a read-only tool —
    // keeps each call isolated. If latency becomes a concern, both could be merged
    // into a single withActualApi using the raw API directly.
    const accounts = await adapter.getAccounts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accountList: any[] = Array.isArray(accounts) ? accounts : [];

    const excludedAccountIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      accountList
        .filter((acc: any) => acc?.offbudget === true || acc?.closed === true)
        .map((acc: any) => acc.id as string)
    );

    const accountNameMap = new Map<string, string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      accountList.map((acc: any) => [acc.id as string, acc.name as string])
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uncategorized = txns.filter((txn: any) => isUncategorized(txn, excludedAccountIds));

    const totalCount = uncategorized.length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalAmount = uncategorized.reduce((sum: number, txn: any) => {
      return sum + (typeof txn?.amount === 'number' ? txn.amount : 0);
    }, 0);

    // Per-account breakdown — one entry per on-budget open account with ≥1 uncategorized txn
    const byAccountMap = new Map<string, { count: number; totalAmount: number }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const txn of uncategorized as any[]) {
      const acctId = txn?.account;
      if (!acctId) continue;
      const entry = byAccountMap.get(acctId) ?? { count: 0, totalAmount: 0 };
      entry.count += 1;
      entry.totalAmount += typeof txn?.amount === 'number' ? txn.amount : 0;
      byAccountMap.set(acctId, entry);
    }
    const byAccount = Array.from(byAccountMap.entries()).map(([acctId, data]) => ({
      accountId: acctId,
      accountName: accountNameMap.get(acctId) ?? acctId,
      count: data.count,
      totalAmount: data.totalAmount,
    }));

    const result: Record<string, unknown> = {
      totalCount,
      totalAmount,
      byAccount,
      dateRange: { startDate, endDate },
    };

    if (input.includeTransactions) {
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      const page = uncategorized.slice(offset, offset + limit);
      result.transactions = page;
      result.count = page.length;
      result.hasMore = offset + page.length < totalCount;
      result.offset = offset;
      result.limit = limit;
    }

    return result;
  },
};

export default tool;
