import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({ "month": z.string().optional() });

// RESPONSE_TYPE: BudgetMonth
type Output = any; // refine using generated types (paths['/budgets/month']['get'])

const tool: ToolDefinition = {
  name: 'actual.budgets.getMonth',
  description: "Get budget month",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    InputSchema.parse(args || {});
    // TODO: implement call to Actual API using generated client/adapters
    return { result: null };

  },
};

export default tool;
