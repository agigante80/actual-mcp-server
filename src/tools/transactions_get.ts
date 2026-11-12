import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  accountId: z.string().optional()
    .describe('Account id from actual_accounts_list; a name is refused with the id it matches. Omit for every account'),
  startDate: z.string().optional().describe('First day, YYYY-MM-DD, inclusive. Omit for no lower bound'),
  endDate: z.string().optional().describe('Last day, YYYY-MM-DD, inclusive. Omit for no upper bound'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_get',
  description:
    "List the transactions of one account, or of every account when accountId is omitted, optionally limited to startDate through endDate (YYYY-MM-DD, inclusive). Read-only. To filter by payee, category, amount or notes use actual_transactions_filter; for totals use actual_transactions_aggregate. Returns { result: [transaction] }, each with id, date, amount (integer cents, negative for an outflow), payee, category, notes and cleared.",
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
