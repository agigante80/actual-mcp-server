import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Category ID to update'),
  fields: z.object({
    name: z.string().optional().describe('New category name'),
    group_id: z.string().optional().describe('Category group ID to move this category to'),
    is_income: z.boolean().optional().describe('Whether this is an income category'),
    hidden: z.boolean().optional().describe('Whether this category is hidden'),
  }).describe('Fields to update'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_categories_update',
  description: 'Update an existing category in Actual Budget. You can rename the category, move it to a different group, or change its properties.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.updateCategory(input.id, input.fields);
    return { success: true };
  },
};

export default tool;
