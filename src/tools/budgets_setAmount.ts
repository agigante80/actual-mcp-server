import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().min(1).describe('Month in YYYY-MM format'),
  categoryId: z.string().min(1).describe('Category ID to set'),
  amount: z.number().describe('Amount to set for the budget category'),
});

// RESPONSE_TYPE: any
type Output = components['schemas']['BudgetSetRequest'] | null | void;

const tool: ToolDefinition = {
  name: 'actual.budgets.setAmount',
  description: "Set budget amount",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args ?? {});
    const month = (input as { month?: string }).month;
    const categoryId = (input as { categoryId?: string }).categoryId;
    const amount = (input as { amount?: number }).amount;
    const res = await adapter.setBudgetAmount(month, categoryId, amount);
    return { result: res };

  },
};

export default tool;
