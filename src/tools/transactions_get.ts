import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';

const InputSchema = z.object({ accountId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() });

const tool: ToolDefinition = {
  name: 'actual_transactions_get',
  description: "Get all transactions for a specific account within a date range. Returns transaction details including date, amount (cents), payee, category, notes, and cleared status. Dates in YYYY-MM-DD format. Perfect for account reconciliation and spending analysis.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Pre-flight: verify account exists when accountId is provided (BUG-7)
    if (input.accountId) {
      const accounts = await adapter.getAccounts();
      const accountExists = (accounts as any[]).some((a: any) => a.id === input.accountId);
      if (!accountExists) {
        return { error: notFoundMsg('Account', input.accountId, 'actual_accounts_list') };
      }
    }
    const result = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
    return { result };
  },
};

export default tool;
