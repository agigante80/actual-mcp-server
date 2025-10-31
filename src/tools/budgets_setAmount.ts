import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ month: z.string().min(1), categoryId: z.string().min(1), amount: z.number() });

// RESPONSE_TYPE: any
type Output = unknown; // refine using generated types (paths['/budgets/month']['post'])

const tool: ToolDefinition = {
  name: 'actual.budgets.setAmount',
  description: "Set budget amount",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.setBudgetAmount(input.month, input.categoryId, input.amount);
    return { result };
  },
};

export default tool;
