import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  payeeName: z.string().describe('Payee name to search for (e.g., "Amazon", "Kroger", "Rent")'),
  startDate: z.string().optional().describe('Optional: Start date in YYYY-MM-DD format'),
  endDate: z.string().optional().describe('Optional: End date in YYYY-MM-DD format'),
  categoryName: z.string().optional().describe('Optional: Filter by category name'),
  minAmount: z.number().optional().describe('Optional: Minimum amount in cents'),
  maxAmount: z.number().optional().describe('Optional: Maximum amount in cents'),
  limit: z.number().optional().default(100).describe('Optional: Maximum number of transactions to return (default: 100)'),
});

type Output = {
  transactions: unknown[];
  count: number;
  totalAmount: number;
  payeeName: string;
};

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_payee',
  description: 'Search transactions by payee name using ActualQL. Returns all transactions for a specific payee with optional date range, category, and amount filters. Useful for analyzing spending patterns with specific vendors or service providers.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Build ActualQL query
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    let query = q('transactions').filter({
      'payee.name': input.payeeName
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
    if (input.categoryName) {
      query = query.filter({ 'category.name': input.categoryName });
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
    
    const result = await adapter.runQuery(query.serialize());
    const transactions = Array.isArray(result) ? result : [];
    
    // Calculate summary stats
    const totalAmount = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions,
      count: transactions.length,
      totalAmount,
      payeeName: input.payeeName,
    };
  },
};

export default tool;
