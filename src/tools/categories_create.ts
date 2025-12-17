import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({ 
  name: CommonSchemas.name, 
  groupId: CommonSchemas.categoryGroupId.nullable().optional(),
  group_id: CommonSchemas.categoryGroupId.nullable().optional(), 
  parentId: CommonSchemas.categoryId.nullable().optional() 
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
      // Normalize field names: convert camelCase to snake_case for Actual API
      const normalizedInput = {
        ...input,
        group_id: input.group_id || input.groupId,
        parent_id: input.parent_id || input.parentId,
      };
      // Remove camelCase versions to avoid confusion
      delete normalizedInput.groupId;
      delete normalizedInput.parentId;
      
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
