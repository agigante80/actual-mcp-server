import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ accountId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() });

const tool: ToolDefinition = {
  name: 'actual_transactions_get',
  description: "Get all transactions for a specific account within a date range. Returns transaction details including date, amount (cents), payee, category, notes, and cleared status. Dates in YYYY-MM-DD format. Perfect for account reconciliation and spending analysis.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Pre-flight: verify the account exists when accountId is provided (BUG-7, then #388).
    // This tool already refused a well-formed id that names nothing, and `verifyExists: true`
    // keeps exactly that. What it gains is the third case: a NAME passed where an id belongs
    // now comes back with the id it resolves to, instead of a refusal that only says not found.
    // It also stops returning `{ error }` and THROWS, per #377: does-not-exist throws.
    if (input.accountId) {
      await adapter.resolveFilterId('account', input.accountId, { verifyExists: true });
    }
    const result = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
    return { result };
  },
};

export default tool;
