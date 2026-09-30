import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  // #380: REQUIRED, and typed. It was `.optional()` with the describe "optional for smoke
  // tests, required for actual usage": a published contract weakened to suit a test. The
  // handler then returned `{ success: true }` for a call with no id, writing nothing, which
  // is the #350 failure this project has spent three releases removing. A model that omitted
  // the id was told its edit had succeeded.
  //
  // The smoke test does supply an id (generated_tools.smoke.test.js), so the escape hatch
  // was not even load bearing when it was removed.
  id: CommonSchemas.transactionId.describe('Transaction ID to update'),
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
    // #305: edit the children of an existing split. #489: or split a PLAIN transaction in
    // place (same id, so imported_id and bank-sync matching are kept). The child amounts must
    // sum to the parent amount, and a split child cannot itself be split; both are enforced in
    // the adapter pre-flight (it reads is_parent, is_child and amount), because the stored
    // amount is not part of this input.
    subtransactions: CommonSchemas.subtransactions
      .optional()
      .describe('Split children. On a plain transaction this splits it in place (same id, import fields kept); on a split it replaces the children. Amounts must sum to the parent amount.'),
  }).describe('Fields to update'),
});


const tool: ToolDefinition = {
  name: 'actual_transactions_update',
  description:
    'Update an existing transaction in Actual Budget. Provide the transaction ID and the fields you want to update. ' +
    'To split an existing transaction across categories in one call, pass fields.subtransactions (amounts summing to the transaction amount): ' +
    'it is split in place, keeping its id and import fields, and the result lists the new child ids. ' +
    'The parent\'s own category is cleared; a child that names no category inherits it.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const split = (await adapter.updateTransaction(input.id, input.fields))?.split;
    // #489: name the children only when a split was CREATED, so the common edit keeps its shape.
    return split ? { success: true, split } : { success: true };
  },
};

export default tool;
