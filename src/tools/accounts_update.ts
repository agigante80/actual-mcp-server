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
  description:
    'Update an account\'s name, offbudget flag or closed flag. Pass them inside fields; only those change, and at least one is required. ' +
    'To close or reopen an account prefer actual_accounts_close or actual_accounts_reopen: close handles the remaining balance. ' +
    'Fails with a not-found refusal for an unknown account id (see actual_accounts_list); a closed account can still be updated. Idempotent. Returns { success, accountId, updatedFields }.',
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
