import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: array
type Output = any; // refine using generated types (paths['/budgets/months']['get'])

const tool: ToolDefinition = {
  name: 'actual.budgets.getMonths',
  description: "Get budget months",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    InputSchema.parse(args || {});
    const result = await adapter.getBudgetMonths();
    return { result };
  },
};

export default tool;
