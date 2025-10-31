import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ name: z.string().min(1), parentId: z.string().optional() });

// RESPONSE_TYPE: string
type Output = unknown; // refine using generated types (paths['/categories']['post'])

const tool: ToolDefinition = {
  name: 'actual.categories.create',
  description: "Create category",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.createCategory(input);
    return { result };
  },
};

export default tool;
