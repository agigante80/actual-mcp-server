import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').describe('Budget month in YYYY-MM format'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_resetHold',
  description: `Reset the budget hold for a month, releasing any amount previously held for next month via holdBudgetForNextMonth.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.resetBudgetHold(input.month);
    return { success: true };
  },
};

export default tool;
