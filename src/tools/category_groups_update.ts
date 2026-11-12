import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  id: CommonSchemas.categoryGroupId.describe('Category group ID to update'),
  fields: z.object({
    name: z.string().optional().describe('New group name'),
    is_income: z.boolean().optional().describe('Whether this is an income category group'),
    hidden: z.boolean().optional().describe('Whether this group is hidden'),
  }).describe('Fields to update'),
});

const tool: ToolDefinition = {
  name: 'actual_category_groups_update',
  description:
    "Change one category group by id: rename it, mark it as an income group, or hide or show it. Only the fields you pass change. Find the id with actual_category_groups_get; to remove a group use actual_category_groups_delete. Returns { success: true }.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.updateCategoryGroup(input.id, input.fields);
    return { success: true };
  },
};

export default tool;
