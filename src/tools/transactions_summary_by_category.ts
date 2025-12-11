import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  startDate: z.string().optional().describe('Start date in YYYY-MM-DD format (default: first day of current month)'),
  endDate: z.string().optional().describe('End date in YYYY-MM-DD format (default: today)'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  includeIncome: z.boolean().optional().default(false).describe('Optional: Include income categories (default: false, only expenses)'),
});

type Output = {
  summary: Array<{
    categoryGroup: string;
    categoryName: string;
    totalAmount: number;
    transactionCount?: number;
  }>;
  totalAmount: number;
  dateRange: {
    startDate: string;
    endDate: string;
  };
};

const tool: ToolDefinition = {
  name: 'actual_transactions_summary_by_category',
  description: 'Get spending summary grouped by category using ActualQL aggregation. Returns total amount and transaction count per category for a date range. Perfect for budget analysis and expense tracking. By default excludes income categories (set includeIncome=true to include them).',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Default to current month if dates not provided
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = input.startDate || firstDayOfMonth.toISOString().split('T')[0];
    const endDate = input.endDate || today.toISOString().split('T')[0];
    
    // Build ActualQL query with groupBy and aggregation
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    // Start with date filter
    let query = q('transactions').filter({
      $and: [
        { date: { $gte: startDate } },
        { date: { $lte: endDate } }
      ]
    });
    
    // Filter by account if specified
    if (input.accountId) {
      query = query.filter({ account: input.accountId });
    }
    
    // Filter out income categories unless requested
    if (!input.includeIncome) {
      query = query.filter({ 'category.is_income': { $ne: true } });
    }
    
    // Group by category and calculate sum
    query = query
      .groupBy(['category.group.name', 'category.name'])
      .select([
        'category.group.name',
        'category.name',
        { totalAmount: { $sum: '$amount' } },
        { transactionCount: { $count: '*' } }
      ])
      .orderBy(['category.group.sort_order', 'category.sort_order']);
    
    const result = await adapter.runQuery(query);
    
    // Ensure result is an array
    if (!result || !Array.isArray(result)) {
      return {
        summary: [],
        totalAmount: 0,
        dateRange: {
          startDate,
          endDate,
        },
      };
    }
    
    const summary = result.map((row: any) => ({
      categoryGroup: row['category.group.name'] || 'Uncategorized',
      categoryName: row['category.name'] || 'Uncategorized',
      totalAmount: row.totalAmount || 0,
      transactionCount: row.transactionCount || 0,
    }));
    
    // Calculate grand total
    const totalAmount = summary.reduce((sum, item) => sum + item.totalAmount, 0);
    
    return {
      summary,
      totalAmount,
      dateRange: {
        startDate,
        endDate,
      },
    };
  },
};

export default tool;
