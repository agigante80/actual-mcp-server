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
  description: 'Search transactions for a specific month. Returns all transactions matching the month and optional filters (account, category, payee, amount range). Efficiently queries by date range.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Step 0: Validate accountId exists if provided
    if (input.accountId) {
      const accounts = await adapter.getAccounts();
      const accountExists = accounts.some((acc: any) => acc.id === input.accountId);
      
      if (!accountExists) {
        // Check if user provided account name instead of UUID
        const accountByName = accounts.find((acc: any) => 
          acc.name && acc.name.toLowerCase() === input.accountId!.toLowerCase()
        );
        
        const month = input.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        
        if (accountByName) {
          return {
            transactions: [],
            count: 0,
            totalAmount: 0,
            month,
            error: `Account '${input.accountId}' appears to be a name, not an ID. Use account UUID '${accountByName.id}' instead.`,
          };
        }
        
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          month,
          error: `Account '${input.accountId}' not found. Did you mean to use account UUID instead of name? Use actual_accounts_list to get valid account UUIDs.`,
        };
      }
    }
    
    // Default to current month if not provided
    const today = new Date();
    const month = input.month || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Calculate the date range for the month
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    
    // Calculate last day of month
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    // Get base transactions (filtered by account and date range)
    const allTransactions = await adapter.getTransactions(
      input.accountId,
      startDate,
      endDate
    );
    
    if (!Array.isArray(allTransactions)) {
      return {
        transactions: [],
        count: 0,
        totalAmount: 0,
        month,
      };
    }
    
    // Apply JavaScript filters
    let filtered = allTransactions;
    
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
          month,
          error: `Category "${input.categoryName}" not found`,
        };
      }
    }
    
    // Filter by payee name (need to lookup payee ID)
    if (input.payeeName) {
      const payees = await adapter.getPayees();
      const payee = payees.find((p: any) =>
        p.name && p.name.toLowerCase() === input.payeeName!.toLowerCase()
      );
      if (payee) {
        filtered = filtered.filter((t: any) => t.payee === payee.id);
      } else {
        // Payee not found - return empty
        return {
          transactions: [],
          count: 0,
          totalAmount: 0,
          month,
          error: `Payee "${input.payeeName}" not found`,
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
      month,
    };
  },
};

export default tool;
