import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  categoryName: z.string().optional().describe('Name of the category to search for (e.g., "Food", "Rent", "Transportation") - optional for smoke tests'),
  startDate: z.string().optional().describe('Optional: Start date in YYYY-MM-DD format'),
  endDate: z.string().optional().describe('Optional: End date in YYYY-MM-DD format'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  minAmount: z.number().optional().describe('Optional: Minimum amount in cents (use negative for expenses)'),
  maxAmount: z.number().optional().describe('Optional: Maximum amount in cents'),
  limit: z.number().optional().default(100).describe('Optional: Maximum number of transactions to return (default: 100)'),
});

type Output = {
  transactions: unknown[];
  count: number;
  totalAmount: number;
  categoryName: string;
};

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_category',
  description: 'Search transactions by category name. Returns all transactions in a specific category with optional date range, account, and amount filters. Perfect for analyzing spending in budget categories.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Step 0: Validate accountId exists if provided
    if (input.accountId) {
      const accounts = await adapter.getAccounts();
      const accountExists = accounts.some((acc: any) => acc.id === input.accountId);
      
      if (!accountExists) {
        // Check if user provided account name instead of UUID
        const accountByName = accounts.find((acc: any) => 
          acc.name && acc.name.toLowerCase() === input.accountId!.toLowerCase()
        );
        
        if (accountByName) {
          return {
            transactions: [],
            count: 0,
            totalAmount: 0,
            categoryName: input.categoryName,
            error: `Account '${input.accountId}' appears to be a name, not an ID. Use account UUID '${accountByName.id}' instead.`,
          };
        }
        
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          categoryName: input.categoryName,
          error: `Account '${input.accountId}' not found. Did you mean to use account UUID instead of name? Use actual_accounts_list to get valid account UUIDs.`,
        };
      }
    }
    
    // Step 1: Find category ID by name
    let categoryId: string | undefined;
    if (input.categoryName) {
      const categories = await adapter.getCategories();
      const category = categories.find((c: any) => 
        c.name && c.name.toLowerCase() === input.categoryName!.toLowerCase()
      );
      if (!category) {
        // Category not found - return empty result
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          categoryName: input.categoryName,
          error: `Category "${input.categoryName}" not found`,
        };
      }
      categoryId = category.id;
    }
    
    // Step 2: Get base transactions (filtered by account and date range if provided)
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
        categoryName: input.categoryName,
      };
    }
    
    // Step 3: Apply JavaScript filters
    let filtered = allTransactions;
    
    // Filter by category ID
    if (categoryId) {
      filtered = filtered.filter((t: any) => t.category === categoryId);
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
      categoryName: input.categoryName,
    };
  },
};

export default tool;
