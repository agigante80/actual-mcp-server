import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  name: z.string().min(1).describe('Category group name'),
  is_income: z.boolean().optional().describe('Whether this is an income category group (default: false)'),
  hidden: z.boolean().optional().describe('Whether this group is hidden (default: false)'),
});

const tool: ToolDefinition = {
  name: 'actual_category_groups_create',
  description:
    "Create a category group, the heading that categories sit under. Not idempotent: repeating the call creates a second group. Add categories to it with actual_categories_create (its group_id); rename or hide it later with actual_category_groups_update. Returns { id, success: true } with the new group id.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const groupId = await adapter.createCategoryGroup(input);
    return { id: groupId, success: true };
  },
};

export default tool;
