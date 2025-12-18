import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  payeeName: z.string().optional().describe('Name of the payee/vendor to search for (optional for smoke tests)'),
  startDate: z.string().optional().describe('Optional: Start date in YYYY-MM-DD format'),
  endDate: z.string().optional().describe('Optional: End date in YYYY-MM-DD format'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
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
  description: 'Search transactions by payee name. Returns all transactions for a specific payee with optional date range, category, and amount filters. Useful for analyzing spending patterns with specific vendors or service providers.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Step 1: Find payee ID by name
    let payeeId: string | undefined;
    if (input.payeeName) {
      const payees = await adapter.getPayees();
      const payee = payees.find((p: any) => 
        p.name && p.name.toLowerCase() === input.payeeName!.toLowerCase()
      );
      if (!payee) {
        // Payee not found - return empty result
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          payeeName: input.payeeName,
          error: `Payee "${input.payeeName}" not found`,
        };
      }
      payeeId = payee.id;
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
        payeeName: input.payeeName,
      };
    }
    
    // Step 3: Apply JavaScript filters
    let filtered = allTransactions;
    
    // Filter by payee ID
    if (payeeId) {
      filtered = filtered.filter((t: any) => t.payee === payeeId);
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
          payeeName: input.payeeName,
          error: `Category "${input.categoryName}" not found`,
        };
      }
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
    
    // Calculate summary stats
    const totalAmount = limited.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    
    return {
      transactions: limited,
      count: limited.length,
      totalAmount,
      payeeName: input.payeeName,
    };
  },
};

export default tool;
