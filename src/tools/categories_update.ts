import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  id: CommonSchemas.categoryId.describe('Category ID to update'),
  fields: z.object({
    name: z.string().optional().describe('New category name'),
    group_id: CommonSchemas.categoryGroupId.optional().describe('Category group ID to move this category to'),
    is_income: z.boolean().optional().describe('Whether this is an income category'),
    hidden: z.boolean().optional().describe('Whether this category is hidden'),
  }).describe('Fields to update'),
});


const tool: ToolDefinition = {
  name: 'actual_categories_update',
  description:
    'Update an existing category: rename it (name), move it to another group (group_id), set is_income, or hide or show it (hidden). Only the fields you pass change. ' +
    'Prefer hidden: true to retire a category; actual_categories_delete removes it. Fails with a not-found refusal for an unknown id (see actual_categories_get); a hidden category is still found. Idempotent. Returns { success: true }.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.updateCategory(input.id, input.fields);
    return { success: true };
  },
};

export default tool;
