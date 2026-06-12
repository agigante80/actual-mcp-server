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
  description: `Update an existing payee in Actual Budget.

Updatable fields:
- name: Payee name (1-255 chars)
- transfer_acct: Transfer account ID if this payee represents an account transfer (optional)
- category: Default category ID to auto-assign to transactions from this payee (optional, null to clear)

Example: Update payee name:
{
  "id": "<payee-uuid>",
  "fields": {
    "name": "Grocery Store"
  }
}

Example: Mark payee as transfer account:
{
  "id": "<payee-uuid>",
  "fields": {
    "transfer_acct": "<account-uuid>"
  }
}`,
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
