import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Category[]
type Output = any; // refine using generated types (paths['/categories']['get'])

const tool: ToolDefinition = {
  name: 'actual.categories.get',
  description: "Get categories",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    InputSchema.parse(args || {});
    // TODO: implement call to Actual API using generated client/adapters
    return { result: null };

  },
};

export default tool;
