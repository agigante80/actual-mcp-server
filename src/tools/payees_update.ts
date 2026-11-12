import { z } from 'zod';
import { CommonSchemas } from '../lib/schemas/common.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: CommonSchemas.payeeId,
  fields: z.object({
    name: CommonSchemas.name.optional(),
    transfer_acct: CommonSchemas.accountId.optional().describe('Transfer account if payee represents account transfer'),
    category: CommonSchemas.categoryId.optional().nullable().describe('Default category ID for this payee (null to clear)'),
  }).strict().optional().describe('Fields to update - only recognized fields allowed'),
});


const tool: ToolDefinition = {
  name: 'actual_payees_update',
  description:
    "Change one payee by id. fields takes name, transfer_acct (the account id, when this payee stands for a transfer to that account) or category (a default category for its transactions, null to clear); at least one is required. category is stored as a payee rule, not on the payee: a value creates or edits the first rule naming this payee with a set-category action, and null deletes that whole rule, its other actions included. That rule may also cover other payees, which change too (see actual_payee_rules_get). Find the id with actual_payees_get; to combine duplicates use actual_payees_merge. Returns { success: true, payeeId, updatedFields }.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206);
    // this tool only adds its domain guard for an empty update.
    const input = InputSchema.parse(args || {});

    if (!input.fields || Object.keys(input.fields).length === 0) {
      throw new Error('No fields provided to update. Include at least one field: name or transfer_acct.');
    }

    await adapter.updatePayee(input.id, input.fields);

    return {
      success: true,
      payeeId: input.id,
      updatedFields: Object.keys(input.fields),
    };
  },
};

export default tool;
