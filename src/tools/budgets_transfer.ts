import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  month: z.string()
    .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM')
    .describe('Month in YYYY-MM format'),
  fromCategoryId: CommonSchemas.categoryId
    .describe('Source category ID to transfer from'),
  toCategoryId: CommonSchemas.categoryId
    .describe('Target category ID to transfer to'),
  amount: z.number()
    .int('amount must be an integer (cents)')
    .positive('amount must be positive (cents)')
    .describe('Amount to transfer in cents (positive integer)'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_transfer',
  description:
    "Move a budgeted amount (positive integer cents) from one category to another within one month (YYYY-MM). The source must have at least that much budgeted and must differ from the target. If the second write fails the error says the source was already lowered: read back with actual_budgets_get_month before retrying. To set an amount outright use actual_budgets_set_amount. Returns { result: { success, transferred, fromCategory, toCategory } }.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    if (input.fromCategoryId === input.toCategoryId) {
      throw new Error('Source and target categories must be different');
    }

    const out = await adapter.transferBudgetAmount(
      input.month,
      input.fromCategoryId,
      input.toCategoryId,
      input.amount,
    );

    return {
      result: {
        success: true,
        transferred: out.transferred,
        fromCategory: out.fromCategory,
        toCategory: out.toCategory,
      },
    };
  },
};

export default tool;
