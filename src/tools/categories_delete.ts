import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  id: CommonSchemas.categoryId.describe('Category ID to delete'),
});


const tool: ToolDefinition = {
  name: 'actual_categories_delete',
  description:
    "Permanently delete one category by id. Its transactions are not moved to another category: recategorize them first with actual_transactions_update_batch if they should keep one. An unknown id is refused, pointing at actual_categories_get. To hide a category instead, use actual_categories_update. Cannot be undone. Returns { success: true }.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteCategory(input.id);
    return { success: true };
  },
};

export default tool;
