import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { withLogMessage } from '../lib/errors.js';

const InputSchema = z.object({ 
  name: CommonSchemas.name, 
  group_id: CommonSchemas.categoryGroupId,
  is_income: z.boolean().nullable().optional()
    .describe('true for an income category; omitted or null means an expense category'),
}).passthrough(); // Allow other fields to pass through

// RESPONSE_TYPE: string

const tool: ToolDefinition = {
  name: 'actual_categories_create',
  description:
    "Create a category inside a category group (group_id; find one with actual_category_groups_get). is_income true makes an income category, otherwise it is an expense category. A name already used in that group is refused. Not idempotent. Returns { success: true, categoryId, message } with the new category id.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206).
    const input = InputSchema.parse(args || {});

    try {
      // Input already has correct field names (group_id, is_income)
      // Convert null to false (LibreChat sometimes sends null instead of undefined)
      const normalizedInput = {
        name: input.name,
        group_id: input.group_id,
        is_income: input.is_income ?? false,
      };
      
      const result = await adapter.createCategory(normalizedInput);
      return { 
        success: true,
        categoryId: result,
        message: `Category "${input.name}" created successfully`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error messages for common issues
      if (errorMessage.includes('groupId is required') || errorMessage.includes('group_id')) {
        throw new Error(`Failed to create category: Invalid or missing group_id. Use actual_category_groups_get to get available category groups first.`);
      }
      if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
        // The client needs the name; the log gets content-free text (#559).
        throw withLogMessage(
          new Error(`Failed to create category: A category named "${input.name}" already exists in this group.`),
          'category name already exists in this group',
        );
      }
      
      throw new Error(`Failed to create category: ${errorMessage}`);
    }
  },
};

export default tool;
