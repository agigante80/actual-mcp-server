import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Category group ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_category_groups_delete',
  description: `Delete a category group from Actual Budget. Note: Categories within the group will be moved to a default group or ungrouped. This operation cannot be undone.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteCategoryGroup(input.id);
    return { success: true };
  },
};

export default tool;
