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
}).refine(data => data.minAmount !== undefined || data.maxAmount !== undefined, {
  message: 'At least one of minAmount or maxAmount must be specified',
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
  description: 'Search transactions by amount range using ActualQL. Useful for finding large expenses, deposits, or transactions within a specific amount range. Amounts are in cents (e.g., $100 = 10000, $-50.25 = -5025). At least one of minAmount or maxAmount must be specified.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Build ActualQL query with amount filter
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    const amountFilter: any = {};
    if (input.minAmount !== undefined) {
      amountFilter.$gte = input.minAmount;
    }
    if (input.maxAmount !== undefined) {
      amountFilter.$lte = input.maxAmount;
    }
    
    let query = q('transactions').filter({ amount: amountFilter });
    
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
    
    if (input.categoryName) {
      query = query.filter({ 'category.name': input.categoryName });
    }
    
    // Select all fields, order by amount descending, and apply limit
    query = query.select('*').orderBy({ amount: 'desc' }).limit(input.limit || 100);
    
    const result = await adapter.runQuery(query.serialize());
    const transactions = Array.isArray(result) ? result : [];
    
    // Calculate summary stats
    const totalAmount = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions,
      count: transactions.length,
      totalAmount,
      amountRange: {
        min: input.minAmount,
        max: input.maxAmount,
      },
    };
  },
};

export default tool;
