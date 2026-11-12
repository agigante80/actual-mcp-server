import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_category_groups_get',
  description:
    "List every category group with the categories inside it. Read-only, no parameters. Use it to find a group_id for actual_categories_create or a group id for actual_category_groups_update; for a flat list of categories use actual_categories_get. Returns { groups: [{ id, name, is_income, hidden, categories: [...] }] }.",
  inputSchema: InputSchema,
  call: async (_args: unknown, _meta?: unknown) => {
    const groups = await adapter.getCategoryGroups();
    return { groups };
  },
};

export default tool;
