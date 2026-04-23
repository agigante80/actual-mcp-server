/**
 * actual_transactions_uncategorized
 *
 * List transactions that have no category assigned.
 *
 * Concept and implementation adapted from the ZanzyTHEbar fork:
 * https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/transactions_uncategorized.ts
 * Credit: ZanzyTHEbar (https://github.com/ZanzyTHEbar)
 *
 * Adapted for this project's conventions:
 * - No wrapToolCall — uses direct call() pattern
 * - Returns { transactions, count, summary, dateRange } matching the search_by_* shape
 */
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  startDate: CommonSchemas.date.optional().describe('Start date in YYYY-MM-DD format (default: first day of current month)'),
  endDate: CommonSchemas.date.optional().describe('End date in YYYY-MM-DD format (default: today)'),
  accountId: CommonSchemas.accountId.optional().describe('Filter by specific account ID (optional)'),
  limit: z.number().optional().default(500).describe('Maximum number of transactions to return (default: 500)'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_uncategorized',
  description: 'List uncategorized transactions (category is null/unset). Excludes transfers, split-transaction parents, opening balance entries, off-budget accounts, and closed accounts — matching Actual Budget\'s own Uncategorized view. Defaults to the current month unless a date range is provided. Returns { transactions, count, summary: { totalAmount }, dateRange }.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = input.startDate || firstDayOfMonth.toISOString().split('T')[0];
    const endDate = input.endDate || today.toISOString().split('T')[0];
    const accountId = input.accountId ?? undefined;

    // Fetch transactions first. When accountId is undefined, rawGetTransactions does
    // a full table scan (no account filter) — this reliably returns newly written
    // transactions even across separate WAL sessions in CI Docker. Filtering by
    // accountId uses a SQLite index that can lag across sessions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txnRaw = await adapter.getTransactions(accountId as any, startDate, endDate);
    const txns = Array.isArray(txnRaw) ? txnRaw : [];

    // Fetch accounts to build exclusion set: off-budget + closed accounts.
    const accounts = await adapter.getAccounts();
    const excludedAccountIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray(accounts) ? accounts : [])
        .filter((acc: any) => acc?.offbudget === true || acc?.closed === true)
        .map((acc: any) => acc.id as string)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uncategorized = txns.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (txn: any) =>
        txn?.category == null &&
        txn?.transfer_id == null &&
        txn?.is_parent !== true &&
        txn?.starting_balance_flag !== true &&
        !excludedAccountIds.has(txn?.account)
    );
    const limited = uncategorized.slice(0, input.limit ?? 500);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalAmount = limited.reduce((sum: number, txn: any) => {
      const amount = typeof txn?.amount === 'number' ? txn.amount : 0;
      return sum + amount;
    }, 0);

    return {
      transactions: limited,
      count: limited.length,
      summary: { totalAmount },
      dateRange: { startDate, endDate },
    };
  },
};

export default tool;
