import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({ 
  name: CommonSchemas.name, 
  group_id: CommonSchemas.categoryGroupId,
  is_income: z.boolean().optional(),
}).passthrough(); // Allow other fields to pass through

// RESPONSE_TYPE: string
type Output = unknown; // refine using generated types (paths['/categories']['post'])

const tool: ToolDefinition = {
  name: 'actual_categories_create',
  description: "Create a category. REQUIRED: group_id (category group UUID). Use actual_category_groups_get to find available groups. Optional: is_income (boolean, defaults to false for expense categories).",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    try {
      // Input already has correct field names (group_id, is_income)
      const normalizedInput = {
        name: input.name,
        group_id: input.group_id,
        is_income: input.is_income ?? false,
      };
      
      const result = await adapter.createCategory(normalizedInput);
      return { result };
    } catch (error) {
      // Log the full error for debugging
      console.error('Categories create error:', error);
      throw error;
    }
  },
};

export default tool;
