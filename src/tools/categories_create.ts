import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({  });

// RESPONSE_TYPE: string
type Output = any; // refine using generated types (paths['/categories']['post'])

const tool: ToolDefinition = {
  name: 'actual.categories.create',
  description: "Create category",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const res = await adapter.createCategory(input as any);
  return { result: res };

  },
};

export default tool;
