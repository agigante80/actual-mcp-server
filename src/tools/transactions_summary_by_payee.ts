import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  startDate: z.string().optional().describe('Start date in YYYY-MM-DD format (default: first day of current month)'),
  endDate: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  limit: z.number().optional().default(50).describe('Optional: Maximum number of payees to return (default: 50, ordered by totalAmount descending)'),
});

type Output = {
  summary: Array<{
    payeeName: string;
    totalAmount: number;
    transactionCount: number;
  }>;
  totalAmount: number;
  dateRange: {
    startDate: string;
    endDate: string;
  };
};

const tool: ToolDefinition = {
  name: 'actual_transactions_summary_by_payee',
  description: 'Get spending summary grouped by payee using ActualQL aggregation. Returns total amount and transaction count per payee for a date range. Useful for identifying top vendors and analyzing merchant spending patterns. Results are ordered by total amount (highest first).',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Build ActualQL query with groupBy and aggregation
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    // Default to current month if dates not provided
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = input.startDate || firstDayOfMonth.toISOString().split('T')[0];
    const endDate = input.endDate || today.toISOString().split('T')[0];
    
    // Start with date filter
    let query = q('transactions').filter({
      $and: [
        { date: { $gte: startDate } },
        { date: { $lte: endDate } }
      ]
    });
    
    // Group by payee and calculate sum
    query = query
      .groupBy('payee.name')
      .select([
        'payee.name',
        { totalAmount: { $sum: '$amount' } },
        { transactionCount: { $count: '*' } }
      ])
      .orderBy({ totalAmount: 'desc' })
      .limit(input.limit || 50);
    
    const result = await adapter.runQuery(query.serialize());
    const summary = Array.isArray(result) ? result.map((row: any) => ({
      payeeName: row['payee.name'] || 'Unknown',
      totalAmount: row.totalAmount || 0,
      transactionCount: row.transactionCount || 0,
    })) : [];
    
    // Calculate grand total
    const totalAmount = summary.reduce((sum, item) => sum + item.totalAmount, 0);
    
    return {
      summary,
      totalAmount,
      dateRange: {
        startDate: input.startDate,
        endDate: input.endDate,
      },
    };
  },
};

export default tool;
