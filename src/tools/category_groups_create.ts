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
  description: `Create a new category group in Actual Budget. Category groups help organize categories into logical sections (e.g., "Fixed Expenses", "Variable Expenses", "Savings Goals"). After creating a group, you can move categories into it.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const groupId = await adapter.createCategoryGroup(input);
    return { id: groupId, success: true };
  },
};

export default tool;
