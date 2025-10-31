import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: array
type Output = components['schemas']['Category'][];

const tool: ToolDefinition = {
  name: 'actual.categories.get',
  description: "Get categories",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    InputSchema.parse(args ?? {});
    const res = await adapter.getCategories();
  return { result: res };

  },
};

export default tool;
