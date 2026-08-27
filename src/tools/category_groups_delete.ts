import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  id: CommonSchemas.categoryGroupId.describe('Category group ID to delete'),
});

/**
 * #376: the existence guard lives in `adapter.deleteCategoryGroup`, which reads and writes
 * in one write-queue cycle. It used to sit here inside the tool's own `withWriteSession`,
 * which cost `retry` on the read and left the adapter method unguarded.
 */
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
