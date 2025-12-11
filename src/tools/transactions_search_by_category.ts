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
  description: 'Search transactions by category name using ActualQL. Returns all transactions in a specific category with optional date range, account, and amount filters. Perfect for analyzing spending in budget categories.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Build ActualQL query
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    let query = q('transactions').filter({
      'category.name': input.categoryName
    });
    
    // Apply date range filters
    if (input.startDate || input.endDate) {
      const dateFilter: any = {};
      if (input.startDate) {
        dateFilter.$gte = input.startDate;
      }
      if (input.endDate) {
        dateFilter.$lte = input.endDate;
      }
      query = query.filter({ date: dateFilter });
    }
    
    // Apply optional filters
    if (input.accountId) {
      query = query.filter({ account: input.accountId });
    }
    
    if (input.minAmount !== undefined || input.maxAmount !== undefined) {
      const amountFilter: any = {};
      if (input.minAmount !== undefined) {
        amountFilter.$gte = input.minAmount;
      }
      if (input.maxAmount !== undefined) {
        amountFilter.$lte = input.maxAmount;
      }
      query = query.filter({ amount: amountFilter });
    }
    
    // Select all fields, order by date descending, and apply limit
    query = query.select('*').orderBy({ date: 'desc' }).limit(input.limit || 100);
    
    const result = await adapter.runQuery(query);
    const transactions = Array.isArray(result) ? result : [];
    
    // Calculate summary stats
    const totalAmount = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions,
      count: transactions.length,
      totalAmount,
      categoryName: input.categoryName,
    };
  },
};

export default tool;
