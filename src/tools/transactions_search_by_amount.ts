import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  minAmount: z.number().optional().describe('Minimum amount in cents (use negative for expenses, e.g., -10000 for $-100.00). For expenses, use negative values (e.g., -5000 for -$50.00)'),
  maxAmount: z.number().optional().describe('Maximum amount in cents (e.g., 10000 for $100.00). For expenses, use negative values (e.g., -5000 for -$50.00)'),
  absoluteAmount: z.number().optional().describe('Optional: Search by absolute value (magnitude) in cents, ignoring sign. E.g., 5000 will match both +$50.00 (income) and -$50.00 (expense). If specified, minAmount/maxAmount are ignored.'),
  startDate: z.string().optional().describe('Optional: Start date in YYYY-MM-DD format'),
  endDate: z.string().optional().describe('Optional: End date in YYYY-MM-DD format'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  categoryName: z.string().optional().describe('Optional: Filter by category name'),
  limit: z.number().optional().default(100).describe('Optional: Maximum number of transactions to return (default: 100)'),
});

type Output = {
  transactions: unknown[];
  count: number;
  totalAmount: number;
  amountRange: {
    min?: number;
    max?: number;
  };
};

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_amount',
  description: 'Search transactions by amount. Supports two modes: (1) Signed amount range using minAmount/maxAmount (expenses are negative, e.g., -5000 for -$50), or (2) Absolute value using absoluteAmount to find any transaction with that magnitude regardless of sign (e.g., absoluteAmount=5000 matches both +$50 income and -$50 expense). When user says "amount 50", use absoluteAmount=5000 to match both income and expenses.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Validate accountId exists if provided
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
            amountRange: {
              min: input.minAmount,
              max: input.maxAmount,
            },
            error: `Account '${input.accountId}' appears to be a name, not an ID. Use account UUID '${accountByName.id}' instead.`,
          };
        }
        
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          amountRange: {
            min: input.minAmount,
            max: input.maxAmount,
          },
          error: `Account '${input.accountId}' not found. Did you mean to use account UUID instead of name? Use actual_accounts_list to get valid account UUIDs.`,
        };
      }
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
        amountRange: {
          min: input.minAmount,
          max: input.maxAmount,
        },
      };
    }
    
    // Apply JavaScript filters
    let filtered = allTransactions;
    
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
          amountRange: {
            min: input.minAmount,
            max: input.maxAmount,
          },
          error: `Category "${input.categoryName}" not found`,
        };
      }
    }
    
    // Sort by amount descending and apply limit
    filtered.sort((a: any, b: any) => {
      const amountA = a.amount || 0;
      const amountB = b.amount || 0;
      return amountB - amountA;
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
      amountRange: input.absoluteAmount !== undefined 
        ? { absolute: input.absoluteAmount }
        : { min: input.minAmount, max: input.maxAmount },
    };
  },
};

export default tool;
