import { z } from 'zod';
import { CommonSchemas } from '../lib/schemas/common.js';
import type { components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ 
  id: CommonSchemas.accountId,
  fields: z.object({
    name: CommonSchemas.name.optional(),
    offbudget: CommonSchemas.offBudget,
    closed: CommonSchemas.closed,
  }).strict().optional().describe('Fields to update - only recognized fields allowed'),
});

const tool: ToolDefinition = {
  name: 'actual_accounts_update',
  description: `Update an account's properties in Actual Budget.

Updatable fields:
- name: Account name (1-255 chars)
- offbudget: Exclude from budget (true/false)
- closed: Mark as closed (true/false)

Example: Update account name and offbudget status:
{
  "id": "<account-uuid>",
  "fields": {
    "name": "Checking Account",
    "offbudget": false
  }
}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      if (!input.fields || Object.keys(input.fields).length === 0) {
        throw new Error('No fields provided to update. Include at least one field: name, offbudget, or closed.');
      }
      
      await adapter.updateAccount(input.id, input.fields);
      
      return { 
        success: true,
        accountId: input.id,
        updatedFields: Object.keys(input.fields),
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Invalid account update data: ${fieldErrors}`);
      }
      throw error;
    }
  },
};

export default tool;
