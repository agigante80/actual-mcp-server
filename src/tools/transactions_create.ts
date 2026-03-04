import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { notFoundMsg } from '../lib/errors.js';

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

type Output = { success: true; id: string } | { success: false; error: string; id: null };

const tool: ToolDefinition = {
  name: 'actual_transactions_create',
  description: 'Create a new transaction in Actual Budget. Amount should be in cents (negative for expenses, positive for income).',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    // Pre-flight: verify account exists (BUG-4)
    const accounts = await adapter.getAccounts();
    const accountExists = (accounts as any[]).some((a: any) => a.id === input.account);
    if (!accountExists) {
      return {
        success: false as const,
        error: notFoundMsg('Account', input.account, 'actual_accounts_list'),
        id: null,
      };
    }

    try {
      // Use addTransactions - it reliably creates transactions
      // Note: API may return "ok" string instead of an ID, which is a known Actual API behavior
      const result = await adapter.addTransactions(input as any);

      if (!result || result.length === 0) {
        return {
          success: false as const,
          error: 'Failed to create transaction — no result returned from API.',
          id: null,
        };
      }

      // The API sometimes returns a UUID and sometimes "ok" depending on version.
      const maybeId = result[0] && result[0] !== 'ok' && result[0].length > 10
        ? result[0]
        : null;

      // Detect silent failure: if id is null, the transaction was not created (BUG-4)
      if (maybeId === null) {
        return {
          success: false as const,
          error: 'Transaction was not created — the API returned no ID. Use actual_accounts_list to verify the account ID.',
          id: null,
        };
      }

      return { success: true as const, id: maybeId };
    } catch (error) {
      throw new Error(`Failed to create transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export default tool;
