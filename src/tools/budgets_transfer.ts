import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string()
    .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM')
    .describe('Month in YYYY-MM format'),
  fromCategoryId: z.string()
    .min(1, 'fromCategoryId is required')
    .describe('Source category ID to transfer from'),
  toCategoryId: z.string()
    .min(1, 'toCategoryId is required')
    .describe('Target category ID to transfer to'),
  amount: z.number()
    .int('amount must be an integer (cents)')
    .positive('amount must be positive (cents)')
    .describe('Amount to transfer in cents (positive integer)'),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_transfer',
  description: 'Transfer budget amount between categories. Decreases the source category budget and increases the target category budget by the specified amount for the given month.',
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
