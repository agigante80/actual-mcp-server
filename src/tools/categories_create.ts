import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ 
  name: z.string().min(1), 
  groupId: z.string().optional(),
  group_id: z.string().optional(), 
  parentId: z.string().optional() 
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
