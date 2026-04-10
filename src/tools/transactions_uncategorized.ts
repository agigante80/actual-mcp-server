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

const InputSchema = z.object({
  startDate: z.string().optional().describe('Start date in YYYY-MM-DD format (default: first day of current month)'),
  endDate: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
  accountId: z.string().optional().describe('Filter by specific account ID (optional)'),
  limit: z.number().optional().default(500).describe('Maximum number of transactions to return (default: 500)'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_uncategorized',
  description: 'List uncategorized transactions (category is null/unset). Useful for cleanup workflows and rule-suggestion prompts. Defaults to the current month unless a date range is provided. Returns { transactions, count, summary: { totalAmount }, dateRange }.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = input.startDate || firstDayOfMonth.toISOString().split('T')[0];
    const endDate = input.endDate || today.toISOString().split('T')[0];
    const accountId = input.accountId ?? undefined;

    const transactions = await adapter.getTransactions(accountId, startDate, endDate);
    const txns = Array.isArray(transactions) ? transactions : [];

    // Exclude off-budget accounts (issue #80) — their transactions can never have
    // categories set; any update is silently discarded by Actual Budget.
    // Follows the same pattern as transactions_search_by_payee.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await adapter.getAccounts();
    const offBudgetIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray(accounts) ? accounts : [])
        .filter((acc: any) => acc?.offbudget === true)
        .map((acc: any) => acc.id as string)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uncategorized = txns.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (txn: any) => txn?.category == null && !offBudgetIds.has(txn?.account)
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
