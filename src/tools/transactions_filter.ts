import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  accountId: z.string().optional().describe('Filter by specific account ID'),
  startDate: z.string().optional().describe('Start date (YYYY-MM-DD format)'),
  endDate: z.string().optional().describe('End date (YYYY-MM-DD format)'),
  minAmount: z.number().optional().describe('Minimum transaction amount in cents (negative for expenses)'),
  maxAmount: z.number().optional().describe('Maximum transaction amount in cents'),
  categoryId: z.string().optional().describe('Filter by category ID'),
  payeeId: z.string().optional().describe('Filter by payee ID'),
  notes: z.string().optional().describe('Search in transaction notes (case-insensitive)'),
  cleared: z.boolean().nullable().optional().describe('Filter by cleared status'),
  reconciled: z.boolean().nullable().optional().describe('Filter by reconciled status'),
});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_transactions_filter',
  description: 'Get transactions with advanced filtering. Supports filtering by amount range, category, payee, notes, and status. Returns filtered transactions matching all specified criteria.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Get base transactions
    const transactions = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
    
    if (!Array.isArray(transactions)) {
      return { result: [] };
    }
    
    // Apply filters
    let filtered = transactions;
    
    // Filter by amount range
    if (input.minAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) >= input.minAmount!);
    }
    if (input.maxAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) <= input.maxAmount!);
    }
    
    // Filter by category
    if (input.categoryId) {
      filtered = filtered.filter((t: any) => t.category === input.categoryId);
    }
    
    // Filter by payee
    if (input.payeeId) {
      filtered = filtered.filter((t: any) => t.payee === input.payeeId);
    }
    
    // Filter by notes (case-insensitive search)
    if (input.notes) {
      const searchTerm = input.notes.toLowerCase();
      filtered = filtered.filter((t: any) => 
        t.notes && t.notes.toLowerCase().includes(searchTerm)
      );
    }
    
    // Filter by cleared status
    if (input.cleared !== undefined) {
      filtered = filtered.filter((t: any) => t.cleared === input.cleared);
    }
    
    // Filter by reconciled status
    if (input.reconciled !== undefined) {
      filtered = filtered.filter((t: any) => t.reconciled === input.reconciled);
    }
    
    return { result: filtered };
  },
};

export default tool;
