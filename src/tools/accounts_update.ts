import { z } from 'zod';
import { CommonSchemas } from '../lib/schemas/common.js';
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
    // Zod validation errors are formatted centrally by actualToolsManager (#206);
    // this tool only adds its domain guard for an empty update.
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
  },
};

export default tool;
