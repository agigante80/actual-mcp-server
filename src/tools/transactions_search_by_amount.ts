import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { isPreflightRefusal } from '../lib/errors.js';
import { expandSplitsForSearch } from '../lib/split-search.js';
import { idSetByName } from '../lib/actual-adapter/filter-ids.js';

const InputSchema = z.object({
  minAmount: z.number().optional().describe('Minimum amount in cents (use negative for expenses, e.g., -10000 for $-100.00). For expenses, use negative values (e.g., -5000 for -$50.00)'),
  maxAmount: z.number().optional().describe('Maximum amount in cents (e.g., 10000 for $100.00). For expenses, use negative values (e.g., -5000 for -$50.00)'),
  absoluteAmount: z.number().optional().describe('Optional: Search by absolute value (magnitude) in cents, ignoring sign. E.g., 5000 will match both +$50.00 (income) and -$50.00 (expense). If specified, minAmount/maxAmount are ignored.'),
  startDate: CommonSchemas.date.optional().describe('Optional: Start date in YYYY-MM-DD format'),
  endDate: CommonSchemas.date.optional().describe('Optional: End date in YYYY-MM-DD format'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  categoryName: z.string().optional().describe('Optional: Filter by category name'),
  limit: z.number().optional().default(100).describe('Optional: Maximum number of transactions to return (default: 100)'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_amount',
  description: 'Search transactions by amount. Supports two modes: (1) Signed amount range using minAmount/maxAmount (expenses are negative, e.g., -5000 for -$50), or (2) Absolute value using absoluteAmount to find any transaction with that magnitude regardless of sign (e.g., absoluteAmount=5000 matches both +$50 income and -$50 expense). When user says "amount 50", use absoluteAmount=5000 to match both income and expenses. Returns up to limit rows (default 100) as { transactions, count, totalAmount, hasMore }; count and totalAmount cover only the returned rows, hasMore is true when more matched. With categoryName, a split is matched by its children; rows carry parent_id.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      // Safeguard: require accountId and/or date range to prevent unbounded
      // full-database scans that can cause OOM / server crashes.
      if (!input.accountId && !input.startDate && !input.endDate) {
        throw new Error(
          'Unbounded query: provide at least one of accountId, startDate, or endDate ' +
          'to limit the scan scope. Full-database scans without filters can exhaust memory.'
        );
      }
      
      // #388: ONE answer to a name passed where an id belongs, shared by every Category B field.
      // This block used to return an empty result set with the error tucked inside it, which reads
      // to a model as "no transactions match". `verifyExists: true` keeps the existence check this
      // tool already paid for.
      // Fetched HERE rather than at the enrichment step below so the guard can reuse it.
      // Both need the same listing, and reading it twice on every filtered call is a cost this
      // change is meant to avoid rather than introduce.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = await adapter.getAccounts();
      if (input.accountId) {
        await adapter.resolveFilterId('account', input.accountId, { verifyExists: true, rows: accounts });
      }

      // Get base transactions (filtered by account and date range if provided)
      const allTransactions = await adapter.getTransactions(
        input.accountId,
        input.startDate,
        input.endDate
      );
      
      if (!Array.isArray(allTransactions)) {
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          hasMore: false,
          amountRange: {
            min: input.minAmount,
            max: input.maxAmount,
          },
        };
      }
      
      // #750: resolve the category BEFORE expanding, so an unknown name returns its existing error
      // result and nothing is expanded. A split parent has a null category, so with a category
      // filter the split is replaced by its children before the amount filters run (an amount
      // filter then compares with the child amount).
      let categoryIds: Set<string> | undefined;
      if (input.categoryName) {
        const categories = await adapter.getCategories();
        const matched = idSetByName(categories, input.categoryName);
        if (matched.size === 0) {
          // Category not found - return empty
          return {
            transactions: [],
            count: 0,
            totalAmount: 0,
            hasMore: false,
            amountRange: {
              min: input.minAmount,
              max: input.maxAmount,
            },
            error: `Category "${input.categoryName}" not found`,
          };
        }
        categoryIds = matched;
      }

      // Apply JavaScript filters
      let filtered = categoryIds ? expandSplitsForSearch(allTransactions).rows : allTransactions;
      
      // Filter by absolute amount (if specified, this takes precedence)
      if (input.absoluteAmount !== undefined) {
        const targetAbs = Math.abs(input.absoluteAmount);
        filtered = filtered.filter((t: any) => Math.abs(t.amount || 0) === targetAbs);
      } else {
        // Filter by signed amount range
        if (input.minAmount !== undefined) {
          filtered = filtered.filter((t: any) => (t.amount || 0) >= input.minAmount!);
        }
        if (input.maxAmount !== undefined) {
          filtered = filtered.filter((t: any) => (t.amount || 0) <= input.maxAmount!);
        }
      }
      
      // Filter by category (resolved above)
      if (categoryIds) {
        filtered = filtered.filter((t: any) => categoryIds.has(t.category));
      }
      
      // Sort by amount descending and apply limit
      filtered.sort((a: any, b: any) => {
        const amountA = a.amount || 0;
        const amountB = b.amount || 0;
        return amountB - amountA;
      });
      
      // #755: computed against the slice, so it agrees with the rows returned even for a negative limit.
      const limited = filtered.slice(0, input.limit || 100);
      const hasMore = filtered.length > limited.length;
      
      // Enrich transactions with account names (listing already in hand, see above)
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
        hasMore,
        amountRange: input.absoluteAmount !== undefined 
          ? { absolute: input.absoluteAmount }
          : { min: input.minAmount, max: input.maxAmount },
      };
    } catch (error: any) {
      const message = error?.message || String(error);
      // #377/#388: a PREFLIGHT REFUSAL is not a crash and must not be flattened into one.
      // This guard exists so an unexpected failure does not take the server down. A refusal is
      // the opposite: a deliberate answer that the request cannot be served, and burying it here
      // would restore exactly the empty-result-with-an-error shape #388 removed.
      if (isPreflightRefusal(error)) throw error;

      // Don't crash the server — return structured error
      return {
        transactions: [],
        count: 0,
        totalAmount: 0,
        hasMore: false,
        amountRange: {},
        error: `search_by_amount failed: ${message}`,
      };
    }
  },
};

export default tool;
