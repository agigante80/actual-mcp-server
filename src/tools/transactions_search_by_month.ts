import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().optional().describe('Month to search in YYYY-MM format (e.g., "2025-01" for January 2025) - defaults to current month'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  categoryName: z.string().optional().describe('Optional: Filter by category name (e.g., "Food", "Rent")'),
  payeeName: z.string().optional().describe('Optional: Filter by payee name'),
  minAmount: z.number().optional().describe('Optional: Minimum amount in cents (use negative for expenses)'),
  maxAmount: z.number().optional().describe('Optional: Maximum amount in cents'),
  limit: z.number().optional().default(100).describe('Optional: Maximum number of transactions to return (default: 100)'),
});

type Output = {
  transactions: unknown[];
  count: number;
  totalAmount: number;
  month: string;
};

const tool: ToolDefinition = {
  name: 'actual_transactions_search_by_month',
  description: 'Search transactions for a specific month using ActualQL. Returns all transactions matching the month and optional filters (account, category, payee, amount range). Uses the $month transform function for efficient monthly queries.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Default to current month if not provided
    const today = new Date();
    const month = input.month || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Build ActualQL query using the $transform function for month filtering
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    let query = q('transactions').filter({
      date: { $transform: '$month', $eq: month }
    });
    
    // Apply optional filters
    if (input.accountId) {
      query = query.filter({ account: input.accountId });
    }
    
    if (input.categoryName) {
      query = query.filter({ 'category.name': input.categoryName });
    }
    
    if (input.payeeName) {
      query = query.filter({ 'payee.name': input.payeeName });
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
      month: input.month,
    };
  },
};

export default tool;
