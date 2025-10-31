import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Category[]
type Output = any; // refine using generated types (paths['/categories']['get'])

const tool: ToolDefinition = {
  name: 'actual.categories.get',
  description: "Get categories",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
    InputSchema.parse(args || {});
    const result = await adapter.getCategories();
    return { result };
  },
};

export default tool;
