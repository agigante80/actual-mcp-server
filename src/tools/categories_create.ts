import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({ 
  name: CommonSchemas.name, 
  group_id: CommonSchemas.categoryGroupId,
  is_income: z.boolean().nullable().optional(),
}).passthrough(); // Allow other fields to pass through

// RESPONSE_TYPE: string
type Output = unknown; // refine using generated types (paths['/categories']['post'])

const tool: ToolDefinition = {
  name: 'actual_categories_create',
  description: "Create a category. REQUIRED: group_id (category group UUID). Use actual_category_groups_get to find available groups. Optional: is_income (boolean, defaults to false for expense categories).",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Validate input with helpful error messages
    let input;
    try {
      input = InputSchema.parse(args || {});
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(issue => {
          if (issue.path.includes('group_id')) {
            return `Invalid group_id: ${issue.message}. Use actual_category_groups_get to find valid category group UUIDs.`;
          }
          if (issue.path.includes('name')) {
            return `Invalid name: ${issue.message}`;
          }
          if (issue.path.includes('is_income')) {
            return `Invalid is_income: ${issue.message}. Must be true or false.`;
          }
          return `${issue.path.join('.')}: ${issue.message}`;
        });
        throw new Error(`Validation failed:\n${issues.join('\n')}`);
      }
      throw error;
    }

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
        throw new Error(`Failed to create category: A category named "${input.name}" already exists in this group.`);
      }
      
      throw new Error(`Failed to create category: ${errorMessage}`);
    }
  },
};

export default tool;
