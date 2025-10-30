import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().min(1).describe('Month in YYYY-MM format'),
  categoryId: z.string().min(1).describe('Category ID to set'),
  amount: z.number().describe('Amount to set for the budget category'),
});

// RESPONSE_TYPE: any
type Output = void | null;

const tool: ToolDefinition = {
  name: 'actual.budgets.setAmount',
  description: "Set budget amount",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const month = (input as any).month;
  const categoryId = (input as any).categoryId;
  const amount = (input as any).amount;
  const res = await adapter.setBudgetAmount(month as any, categoryId as any, amount as any);
  return { result: res };

  },
};

export default tool;
