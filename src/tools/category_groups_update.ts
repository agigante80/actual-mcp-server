import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Category group ID to update'),
  fields: z.object({
    name: z.string().optional().describe('New group name'),
    is_income: z.boolean().optional().describe('Whether this is an income category group'),
    hidden: z.boolean().optional().describe('Whether this group is hidden'),
  }).describe('Fields to update'),
});

const tool: ToolDefinition = {
  name: 'actual_category_groups_update',
  description: `Update an existing category group in Actual Budget. You can rename the group, change whether it's an income group, or hide/show it.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.updateCategoryGroup(input.id, input.fields);
    return { success: true };
  },
};

export default tool;
