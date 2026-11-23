import { z } from 'zod';
import { CommonSchemas } from '../lib/schemas/common.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: CommonSchemas.payeeId,
  fields: z.object({
    name: CommonSchemas.name.optional(),
    category: CommonSchemas.categoryId.optional().nullable().describe('Default category ID for this payee (null to clear)'),
  }).strict().optional().describe('Fields to update - only recognized fields allowed'),
});


const tool: ToolDefinition = {
  name: 'actual_payees_update',
  description:
    "Change one payee by id. fields takes name or category (a default category for its transactions, null to clear); at least one is required. category is stored as a default-stage payee rule whose only condition is this payee and only action sets the category: a value edits that rule or creates it, and null deletes it. Rules naming this payee together with other payees, other conditions or other actions, and pre or post stage rules, are never touched. A transfer payee cannot be renamed (its name is its account's name): rename the account. Find the id with actual_payees_get; to combine duplicates use actual_payees_merge. Returns { success: true, payeeId, updatedFields }.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206);
    // this tool only adds its domain guard for an empty update.
    const input = InputSchema.parse(args || {});

    if (!input.fields || Object.keys(input.fields).length === 0) {
      throw new Error('No fields provided to update. Include at least one field: name or category.');
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
