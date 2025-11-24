import { z } from 'zod';
import { CommonSchemas } from '../lib/schemas/common.js';
import type { components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: CommonSchemas.payeeId,
  fields: z.object({
    name: CommonSchemas.name.optional(),
    notes: CommonSchemas.notes,
    category: CommonSchemas.categoryId.optional().describe('Default category for transactions from this payee'),
    transfer_acct: CommonSchemas.accountId.optional().describe('Transfer account if payee represents account transfer'),
  }).strict().optional().describe('Fields to update - only recognized fields allowed'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_payees_update',
  description: `Update an existing payee in Actual Budget.

Updatable fields:
- name: Payee name (1-255 chars)
- notes: Payee notes/description (max 1000 chars)
- category: Default category for transactions from this payee (use category UUID)
- transfer_acct: Mark as transfer payee linked to account (use account UUID)

Example: Set default category for a payee:
{
  "id": "<payee-uuid>",
  "fields": {
    "category": "<category-uuid>"
  }
}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      if (!input.fields || Object.keys(input.fields).length === 0) {
        throw new Error('No fields provided to update. Include at least one field: name, notes, category, or transfer_acct.');
      }
      
      await adapter.updatePayee(input.id, input.fields);
      
      return { 
        success: true,
        payeeId: input.id,
        updatedFields: Object.keys(input.fields),
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Invalid payee update data: ${fieldErrors}`);
      }
      throw error;
    }
  },
};

export default tool;
