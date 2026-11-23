import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { isPreflightRefusal, withLogMessage } from '../lib/errors.js';

const InputSchema = z.object({ 
  name: CommonSchemas.name, 
  group_id: CommonSchemas.categoryGroupId,
  is_income: z.boolean().nullable().optional()
    .describe('must match the group; omitted or null takes the group\'s flag'),
}).passthrough(); // Allow other fields to pass through

// RESPONSE_TYPE: string

const tool: ToolDefinition = {
  name: 'actual_categories_create',
  description:
    "Create a category inside a category group (group_id; find one with actual_category_groups_get). is_income defaults to the group's flag (an income group gives an income category); a different value is refused with a conflict refusal (nothing is created). An unknown group_id is refused with a not-found refusal (nothing is created). A name already used in that group is refused. Not idempotent. Returns { success: true, categoryId, message } with the new category id.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206).
    const input = InputSchema.parse(args || {});

    try {
      // Input already has correct field names (group_id, is_income)
      // #764: forward is_income only when given (null counts as omitted); the adapter takes the group's flag.
      const normalizedInput: { name: string; group_id: string; is_income?: boolean } = {
        name: input.name,
        group_id: input.group_id,
        ...(typeof input.is_income === 'boolean' ? { is_income: input.is_income } : {}),
      };
      
      const result = await adapter.createCategory(normalizedInput);
      return { 
        success: true,
        categoryId: result,
        message: `Category "${input.name}" created successfully`
      };
    } catch (error) {
      // A typed refusal (unknown category group, #763) keeps its class and exact text.
      if (isPreflightRefusal(error)) throw error;
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
