import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_category_groups_get',
  description: `List all category groups in Actual Budget. Category groups organize related categories together (e.g., "Monthly Bills" group contains "Rent", "Utilities", "Internet" categories). Each group has an ID, name, and optional properties.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const groups = await adapter.getCategoryGroups();
    return { groups };
  },
};

export default tool;
