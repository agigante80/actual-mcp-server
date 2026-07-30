import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas, subtransactionsSum } from '../lib/schemas/common.js';

const InputSchema = z
  .object({
    account: CommonSchemas.accountId,
    date: CommonSchemas.date,
    amount: CommonSchemas.amountCents,
    payee: CommonSchemas.payeeId.optional(),
    payee_name: z.string().optional().describe('Payee name (alternative to payee ID)'),
    notes: CommonSchemas.notes,
    category: CommonSchemas.categoryId.optional(),
    cleared: CommonSchemas.cleared,
    imported_id: z.string().optional().describe('Original imported transaction ID'),
    subtransactions: CommonSchemas.subtransactions
      .optional()
      .describe('Split this transaction: child amounts (integer cents) must sum to `amount`. Put categories on the children, not the parent.'),
  })
  // #305: cross-field split rules. The API does NOT enforce the sum invariant
  // (a mismatch is stored and only flagged in the app), and a split parent
  // carries no category (it moves to the children), so both are enforced here.
  .superRefine((val, ctx) => {
    if (!val.subtransactions) return;
    if (val.category != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'A split parent carries no category; put categories on the subtransactions instead.',
      });
    }
    const sum = subtransactionsSum(val.subtransactions);
    if (sum !== val.amount) {
      ctx.addIssue({
        code: 'custom',
        path: ['subtransactions'],
        message: `Subtransactions must sum to the parent amount. Expected ${val.amount}, got ${sum}.`,
      });
    }
  });


const tool: ToolDefinition = {
  name: 'actual_transactions_create',
  description: 'Create a new transaction in Actual Budget. Amount should be in cents (negative for expenses, positive for income).',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    // #305: a split parent must carry is_parent so @actual-app/api links the
    // children (without it the subtransactions are ignored). The sum invariant
    // and the no-parent-category rule were already enforced by the schema above.
    const payload = input.subtransactions ? { ...input, is_parent: true } : input;

    try {
      // Use addTransactions - it reliably creates transactions.
      // Note: API may return "ok" string instead of a UUID depending on server version.
      // "ok" is a valid success indicator — the transaction WAS created.
      const result = await adapter.addTransactions(payload as any);

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
