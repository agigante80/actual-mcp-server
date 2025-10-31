import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Payee[]
type Output = any; // refine using generated types (paths['/payees']['get'])

const tool: ToolDefinition = {
  name: 'actual.payees.get',
  description: "Get payees",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
    InputSchema.parse(args || {});
    const result = await adapter.getPayees();
    return { result };
  },
};

export default tool;
