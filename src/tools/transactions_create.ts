import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  account: CommonSchemas.accountId,
  date: CommonSchemas.date,
  amount: CommonSchemas.amountCents,
  payee: CommonSchemas.payeeId.optional(),
  payee_name: z.string().optional().describe('Payee name (alternative to payee ID)'),
  notes: CommonSchemas.notes,
  category: CommonSchemas.categoryId.optional(),
  cleared: CommonSchemas.cleared,
  imported_id: z.string().optional().describe('Original imported transaction ID'),
});

type Output = { success: true; id: string | null } | { success: false; error: string; id: null };

const tool: ToolDefinition = {
  name: 'actual_transactions_create',
  description: 'Create a new transaction in Actual Budget. Amount should be in cents (negative for expenses, positive for income).',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    try {
      // Use addTransactions - it reliably creates transactions.
      // Note: API may return "ok" string instead of a UUID depending on server version.
      // "ok" is a valid success indicator — the transaction WAS created.
      const result = await adapter.addTransactions(input as any);

      if (!result || result.length === 0) {
        return {
          success: false as const,
          error: 'Failed to create transaction — no result returned from API. Use actual_accounts_list to verify the account ID.',
          id: null,
        };
      }

      // The API sometimes returns a UUID and sometimes "ok" depending on server version.
      // Both are success — "ok" means created but no ID available from this API version.
      const maybeId = result[0] && result[0] !== 'ok' && result[0].length > 10
        ? result[0]
        : null;

      return { success: true as const, id: maybeId };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('not found') && msg.toLowerCase().includes('account')) {
        // Return structured error (not throw) so callers receive { success: false, error }
        return { success: false as const, error: msg, id: null };
      }
      throw new Error(`Failed to create transaction: ${msg}`);
    }
  },
};

export default tool;
