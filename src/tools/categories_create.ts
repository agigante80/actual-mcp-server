import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({ 
  name: CommonSchemas.name, 
  groupId: CommonSchemas.categoryGroupId.optional(),
  group_id: CommonSchemas.categoryGroupId.optional(), 
  parentId: CommonSchemas.categoryId.optional() 
}).passthrough(); // Allow other fields to pass through

// RESPONSE_TYPE: string
type Output = unknown; // refine using generated types (paths['/categories']['post'])

const tool: ToolDefinition = {
  name: 'actual_categories_create',
  description: "Create category",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    try {
      const result = await adapter.createCategory(input);
      return { result };
    } catch (error) {
      // Log the full error for debugging
      console.error('Categories create error:', error);
      throw error;
    }
  },
};

export default tool;
