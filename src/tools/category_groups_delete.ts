// #232: load the navigator polyfill before @actual-app/api so the Node 20 global is defined first.
import '../lib/node-polyfills.js';
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getCategoryGroups: rawGetCategoryGroups, deleteCategoryGroup: rawDeleteCategoryGroup } = api as any;

const InputSchema = z.object({
  id: z.string().describe('Category group ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_category_groups_delete',
  description: `Delete a category group from Actual Budget. Note: Categories within the group will be moved to a default group or ungrouped. This operation cannot be undone.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Read+write inside one withWriteSession cycle (#142).
    return await adapter.withWriteSession(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groups: any[] = await rawGetCategoryGroups();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groupExists = groups.some((g: any) => g.id === input.id);
      if (!groupExists) {
        // Throw (not return {success:false}) so a non-existent id surfaces as an MCP
        // error, consistent with every other delete tool's not-found behavior.
        throw new Error(notFoundMsg('Category group', input.id, 'actual_category_groups_get'));
      }
      await rawDeleteCategoryGroup(input.id);
      return { success: true };
    });
  },
};

export default tool;
