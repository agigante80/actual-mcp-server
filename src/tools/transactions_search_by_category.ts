import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { expandSplitsForSearch } from '../lib/split-search.js';
import { idSetByName } from '../lib/actual-adapter/filter-ids.js';
import { refuseOffBudgetAccount } from '../lib/search-account-guard.js';

const InputSchema = z.object({
  categoryName: z.string().optional().describe('Name of the category to search for (e.g., "Food", "Rent", "Transportation")'),
  startDate: CommonSchemas.date.optional().describe('Start date in YYYY-MM-DD format'),
  endDate: CommonSchemas.date.optional().describe('End date in YYYY-MM-DD format'),
  accountId: z.string().optional().describe('Filter by specific account ID'),
  minAmount: z.number().optional().describe('Minimum amount in cents (use negative for expenses)'),
  maxAmount: z.number().optional().describe('Maximum amount in cents'),
  limit: z.number().optional().default(100).describe('Maximum number of transactions to return'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_category',
  description:
    'Search transactions by category name (case-insensitive exact match, e.g. "Groceries"), optionally narrowed by a YYYY-MM-DD date range, accountId and an amount range in integer cents. Read-only; off-budget accounts are excluded, and an off-budget accountId is refused. ' +
    'Returns up to limit rows (default 100), newest first, as { transactions, count, totalAmount, hasMore, categoryName }, each row with accountName; count and totalAmount cover only the returned rows, hasMore is true when more rows matched. With categoryName, a split is matched by its children; rows carry parent_id. ' +
    'An unknown category name returns an empty list with an error field. With a category id use actual_transactions_filter; for per-category totals use actual_transactions_aggregate.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Fetch accounts once — used for validation, off-budget filtering (issue #81), and enrichment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allAccounts = await adapter.getAccounts();

    // #388: ONE answer to a name passed where an id belongs, shared by every Category B field.
    // This block used to return an empty result set with the error tucked inside it, which reads
    // to a model as "no transactions match". `verifyExists: true` keeps the existence check this
    // tool already paid for.
    if (input.accountId) {
      await adapter.resolveFilterId('account', input.accountId, { verifyExists: true, rows: allAccounts });
      // #756: an explicit off-budget account is refused, not answered with an empty list.
      refuseOffBudgetAccount(allAccounts, input.accountId);
    }

    // Step 1: Find category ID by name
    let categoryIds: Set<string> | undefined;
    if (input.categoryName) {
      const categories = await adapter.getCategories();
      // #802: every category carrying the name (the same name can sit in two groups).
      const matched = idSetByName(categories, input.categoryName);
      if (matched.size === 0) {
        // Category not found - return empty result
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          hasMore: false,
          categoryName: input.categoryName,
          error: `Category "${input.categoryName}" not found`,
        };
      }
      categoryIds = matched;
    }
    
    // Step 2: Get base transactions (filtered by account and date range if provided)
    // getTransactions() requires an accountId — when none is provided, fetch from all accounts.
    // Exclude off-budget accounts (issue #81) — their transactions cannot have categories set;
    // any update is silently discarded by Actual Budget.
    const offBudgetIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray(allAccounts) ? allAccounts : [])
        .filter((acc: any) => acc?.offbudget === true)
        .map((acc: any) => acc.id as string)
    );

    let allTransactions: any[];
    if (input.accountId) {
      const raw = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allTransactions = (Array.isArray(raw) ? raw : []).filter((t: any) => !offBudgetIds.has(t?.account));
    } else {
      // Only fetch from on-budget accounts — skip off-budget entirely (more efficient)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const budgetAccounts = allAccounts.filter((acc: any) => !acc?.offbudget);
      const perAccount = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        budgetAccounts.map((acc: any) =>
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
        hasMore: false,
        categoryName: input.categoryName,
      };
    }
    
    // Step 3: Apply JavaScript filters
    let filtered = allTransactions;
    
    // Filter by category ID. #750: a split parent has a null category, so search its children.
    if (categoryIds) {
      filtered = expandSplitsForSearch(filtered).rows;
      filtered = filtered.filter((t: any) => categoryIds.has(t.category));
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
    
    // #755: computed against the slice, so it agrees with the rows returned even for a negative limit.
    const limited = filtered.slice(0, input.limit || 100);
    const hasMore = filtered.length > limited.length;
    
    // Enrich transactions with account names (reuse already-fetched allAccounts)
    const accountMap = new Map(allAccounts.map((acc: any) => [acc.id, acc.name]));
    
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
      categoryName: input.categoryName,
    };
  },
};

export default tool;
