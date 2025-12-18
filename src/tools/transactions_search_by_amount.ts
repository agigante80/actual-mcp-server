import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  minAmount: z.number().optional().describe('Minimum amount in cents (use negative for expenses, e.g., -10000 for $-100.00)'),
  maxAmount: z.number().optional().describe('Maximum amount in cents (e.g., 10000 for $100.00)'),
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
  description: 'Search transactions by amount range. Useful for finding large expenses, deposits, or transactions within a specific amount range. Amounts are in cents (e.g., $100 = 10000, $-50.25 = -5025). At least one of minAmount or maxAmount must be specified.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
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
    
    // Filter by amount range
    if (input.minAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) >= input.minAmount!);
    }
    if (input.maxAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) <= input.maxAmount!);
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
    
    // Calculate summary stats
    const totalAmount = limited.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions: limited,
      count: limited.length,
      totalAmount,
      amountRange: {
        min: input.minAmount,
        max: input.maxAmount,
      },
    };
  },
};

export default tool;
