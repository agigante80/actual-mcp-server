import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().optional().describe('Month to search in YYYY-MM format, e.g. "2025-01" (default: the current month)'),
  accountId: z.string().optional().describe('Filter by specific account ID'),
  categoryName: z.string().optional().describe('Filter by category name (e.g., "Food", "Rent")'),
  payeeName: z.string().optional().describe('Filter by payee name'),
  minAmount: z.number().optional().describe('Minimum amount in cents (use negative for expenses)'),
  maxAmount: z.number().optional().describe('Maximum amount in cents'),
  limit: z.number().optional().default(100).describe('Maximum number of transactions to return'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_month',
  description:
    'Search the transactions of one calendar month (month as YYYY-MM, default the current month), optionally narrowed by accountId, categoryName, payeeName (case-insensitive exact names) and an amount range in integer cents. Read-only; off-budget accounts are excluded. ' +
    'Returns up to limit rows (default 100), newest first, as { transactions, count, totalAmount, month }. count and totalAmount cover only the returned rows, so raise limit for a full total. ' +
    'An unknown category or payee name returns an empty list with an error field. For other date ranges or aggregation use actual_query_run.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Fetched HERE rather than further down so the #388 guard below can reuse it. The guard
    // needs the listing and so does the off-budget filtering, and without sharing them this
    // handler read the same listing twice on every filtered call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await adapter.getAccounts();

    // #388: ONE answer to a name passed where an id belongs, shared by every Category B field.
    // This block used to return { transactions: [], count: 0, ..., error }, an empty result set
    // with the error tucked inside it, which reads to a model as "no transactions match".
    // `verifyExists: true` keeps the existence check this tool already paid for.
    if (input.accountId) {
      await adapter.resolveFilterId('account', input.accountId, { verifyExists: true, rows: accounts });
    }

    // Default to current month if not provided
    const today = new Date();
    const month = input.month || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Calculate the date range for the month
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    
    // Calculate last day of month
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    // Get base transactions (filtered by account and date range)
    const allTransactions = await adapter.getTransactions(
      input.accountId,
      startDate,
      endDate
    );
    
    if (!Array.isArray(allTransactions)) {
      return {
        transactions: [],
        count: 0,
        totalAmount: 0,
        month,
      };
    }

    // Exclude off-budget accounts (issue #81) — their transactions cannot have
    // categories set; any update is silently discarded by Actual Budget.
    const offBudgetIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray(accounts) ? accounts : [])
        .filter((acc: any) => acc?.offbudget === true)
        .map((acc: any) => acc.id as string)
    );

    // Apply JavaScript filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let filtered = allTransactions.filter((t: any) => !offBudgetIds.has(t?.account));
    
    // Filter by category name (need to lookup category ID)
    if (input.categoryName) {
      const categories = await adapter.getCategories();
      const category = categories.find((c: any) =>
        c.name && c.name.toLowerCase() === input.categoryName!.toLowerCase()
      );
      if (category) {
        filtered = filtered.filter((t: any) => t.category === category.id);
      } else {
        // Category not found - return empty
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          month,
          error: `Category "${input.categoryName}" not found`,
        };
      }
    }
    
    // Filter by payee name (need to lookup payee ID)
    if (input.payeeName) {
      const payees = await adapter.getPayees();
      const payee = payees.find((p: any) =>
        p.name && p.name.toLowerCase() === input.payeeName!.toLowerCase()
      );
      if (payee) {
        filtered = filtered.filter((t: any) => t.payee === payee.id);
      } else {
        // Payee not found - return empty
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          month,
          error: `Payee "${input.payeeName}" not found`,
        };
      }
    }
    
    // Filter by amount range
    if (input.minAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) >= input.minAmount!);
    }
    if (input.maxAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) <= input.maxAmount!);
    }
    
    // Sort by date descending and apply limit
    filtered.sort((a: any, b: any) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
    
    const limited = filtered.slice(0, input.limit || 100);
    
    // Enrich transactions with account names (reuse already-fetched accounts)
    const accountMap = new Map(accounts.map((acc: any) => [acc.id, acc.name]));
    
    const enrichedTransactions = limited.map((t: any) => ({
      ...t,
      accountName: accountMap.get(t.account) || t.account,
    }));
    
    // Calculate summary stats
    const totalAmount = limited.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions: enrichedTransactions,
      count: enrichedTransactions.length,
      totalAmount,
      month,
    };
  },
};

export default tool;
