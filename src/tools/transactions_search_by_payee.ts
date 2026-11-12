import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  payeeName: z.string().optional().describe('Name of the payee/vendor to search for'),
  startDate: z.string().optional().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().optional().describe('End date in YYYY-MM-DD format'),
  accountId: z.string().optional().describe('Filter by specific account ID'),
  categoryName: z.string().optional().describe('Filter by category name'),
  minAmount: z.number().optional().describe('Minimum amount in cents'),
  maxAmount: z.number().optional().describe('Maximum amount in cents'),
  limit: z.number().optional().default(100).describe('Maximum number of transactions to return'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_payee',
  description:
    'Search transactions by payee name (case-insensitive exact match, e.g. "Amazon"), optionally narrowed by a YYYY-MM-DD date range, accountId, categoryName and an amount range in integer cents. Read-only; off-budget accounts are included. ' +
    'Returns up to limit rows (default 100), newest first, as { transactions, count, totalAmount, payeeName }, each row with accountName; count and totalAmount cover only the returned rows. ' +
    'An unknown payee or category name returns an empty list with an error field. With a payee id use actual_transactions_filter; for per-payee totals use actual_transactions_aggregate.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // #388: ONE answer to a name passed where an id belongs, shared by every Category B field.
    // This block used to return an empty result set with the error tucked inside it, which reads
    // to a model as "no transactions match". `verifyExists: true` keeps the existence check this
    // tool already paid for.
    if (input.accountId) {
      await adapter.resolveFilterId('account', input.accountId, { verifyExists: true });
    }

    // Step 1: Find payee ID by name
    let payeeId: string | undefined;
    if (input.payeeName) {
      const payees = await adapter.getPayees();
      const payee = payees.find((p: any) => 
        p.name && p.name.toLowerCase() === input.payeeName!.toLowerCase()
      );
      if (!payee) {
        // Payee not found - return empty result
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          payeeName: input.payeeName,
          error: `Payee "${input.payeeName}" not found`,
        };
      }
      payeeId = payee.id;
    }
    
    // Step 2: Get base transactions (filtered by account and date range if provided)
    // getTransactions() requires an accountId — when none is provided, fetch from all accounts
    let allTransactions: any[];
    if (input.accountId) {
      allTransactions = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
    } else {
      const allAccounts = await adapter.getAccounts();
      const perAccount = await Promise.all(
        allAccounts.map((acc: any) =>
          adapter.getTransactions(acc.id, input.startDate, input.endDate).catch(() => [])
        )
      );
      // Deduplicate by id (split transactions appear in both parent and child accounts)
      const seen = new Set<string>();
      allTransactions = perAccount.flat().filter((t: any) => {
        if (!t.id || seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }

    if (!Array.isArray(allTransactions)) {
      return {
        transactions: [],
        count: 0,
        totalAmount: 0,
        payeeName: input.payeeName,
      };
    }
    
    // Step 3: Apply JavaScript filters
    let filtered = allTransactions;
    
    // Filter by payee ID
    if (payeeId) {
      filtered = filtered.filter((t: any) => t.payee === payeeId);
    }
    
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
          payeeName: input.payeeName,
          error: `Category "${input.categoryName}" not found`,
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
    
    // Enrich transactions with account names
    const accounts = await adapter.getAccounts();
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
      payeeName: input.payeeName,
    };
  },
};

export default tool;
