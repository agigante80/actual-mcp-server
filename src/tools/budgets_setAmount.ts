import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ month: z.string().min(1), categoryId: z.string().min(1), amount: z.number() });

// RESPONSE_TYPE: any
type Output = unknown; // refine using generated types (paths['/budgets/month']['post'])

const tool: ToolDefinition = {
  name: 'actual_budgets_setAmount',
  description: "Set the budgeted amount for a specific category in a given month. Amount in cents (e.g., 50000 = $500). Use this to allocate money to spending categories for budget planning.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.setBudgetAmount(input.month, input.categoryId, input.amount);
    return { result };
  },
};

export default tool;
