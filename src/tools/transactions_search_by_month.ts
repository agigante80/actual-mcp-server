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
    
    // Calculate the date range for the month
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    
    // Calculate last day of month
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    // Get transactions using the reliable adapter method (same as transactions_filter)
    let transactions = await adapter.getTransactions(input.accountId, startDate, endDate);
    
    if (!Array.isArray(transactions)) {
      transactions = [];
    }
    
    // Apply additional filters in JavaScript
    if (input.categoryName) {
      const categoryNameLower = input.categoryName.toLowerCase();
      transactions = transactions.filter((t: any) => 
        t.category?.name?.toLowerCase() === categoryNameLower
      );
    }
    
    if (input.payeeName) {
      const payeeNameLower = input.payeeName.toLowerCase();
      transactions = transactions.filter((t: any) => 
        t.payee?.name?.toLowerCase() === payeeNameLower
      );
    }
    
    if (input.minAmount !== undefined) {
      transactions = transactions.filter((t: any) => (t.amount || 0) >= input.minAmount!);
    }
    
    if (input.maxAmount !== undefined) {
      transactions = transactions.filter((t: any) => (t.amount || 0) <= input.maxAmount!);
    }
    
    // Apply limit and sort
    transactions = transactions
      .sort((a: any, b: any) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA); // Descending order
      })
      .slice(0, input.limit || 100);
    
    // Calculate summary stats
    const totalAmount = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions,
      count: transactions.length,
      totalAmount,
      month,
    };
  },
};

export default tool;
