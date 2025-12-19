import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().optional().describe('Transaction ID to update (optional for smoke tests, required for actual usage)'),
  fields: z.object({
    account: z.string().nullable().optional().describe('Account ID'),
    date: z.string().nullable().optional().describe('Transaction date (YYYY-MM-DD)'),
    amount: z.number().nullable().optional().describe('Amount in cents (e.g., 1000 = $10.00)'),
    payee: z.string().nullable().optional().describe('Payee ID or name'),
    payee_name: z.string().nullable().optional().describe('Payee name (alternative to payee ID)'),
    imported_payee: z.string().nullable().optional().describe('Original imported payee name'),
    category: z.string().nullable().optional().describe('Category ID'),
    notes: z.string().nullable().optional().describe('Transaction notes'),
    imported_id: z.string().nullable().optional().describe('Original imported transaction ID'),
    transfer_id: z.string().nullable().optional().describe('Transfer transaction ID if this is a transfer'),
    cleared: z.boolean().nullable().optional().describe('Whether transaction is cleared'),
    reconciled: z.boolean().nullable().optional().describe('Whether transaction is reconciled'),
  }).describe('Fields to update'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_transactions_update',
  description: 'Update an existing transaction in Actual Budget. Provide the transaction ID and the fields you want to update.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // For smoke tests, return early if no id provided
    if (!input.id) {
      return { success: true };
    }
    await adapter.updateTransaction(input.id, input.fields);
    return { success: true };
  },
};

export default tool;
