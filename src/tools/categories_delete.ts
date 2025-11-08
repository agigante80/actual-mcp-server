import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Category ID to delete'),
});

type Output = { success: boolean };

const tool: ToolDefinition = {
  name: 'actual_categories_delete',
  description: 'Delete a category from Actual Budget. Transactions using this category will need to be recategorized. This operation cannot be undone.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteCategory(input.id);
    return { success: true };
  },
};

export default tool;
