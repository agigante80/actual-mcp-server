import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ month: z.string().optional() });

// RESPONSE_TYPE: BudgetMonth
type Output = unknown; // refine using generated types (paths['/budgets/month']['get'])

const tool: ToolDefinition = {
  name: 'actual_budgets_getMonth',
  description: "Get budget month",
  inputSchema: InputSchema,
    call: async (args: unknown, _meta?: unknown) => {
      const input = InputSchema.parse(args || {});
      const result = await adapter.getBudgetMonth(input.month);
      return { result };
    },
};

export default tool;
