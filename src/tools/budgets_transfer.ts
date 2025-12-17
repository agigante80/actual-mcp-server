import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  month: z.string().describe('Month in YYYY-MM format'),
  fromCategoryId: z.string().describe('Source category ID to transfer from'),
  toCategoryId: z.string().describe('Target category ID to transfer to'),
  amount: z.number().describe('Amount to transfer in cents (positive integer)'),
});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_budgets_transfer',
  description: 'Transfer budget amount between categories. Decreases the source category budget and increases the target category budget by the specified amount for the given month.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    if (input.amount <= 0) {
      throw new Error('Transfer amount must be positive');
    }
    
    if (input.fromCategoryId === input.toCategoryId) {
      throw new Error('Source and target categories must be different');
    }
    
    // Get current budget for both categories
    const budgetMonth = await adapter.getBudgetMonth(input.month) as any;
    
    if (!budgetMonth || !budgetMonth.categoryGroups) {
      throw new Error(`Budget not found for month ${input.month}`);
    }
    
    // Flatten categories from all groups
    const allCategories = budgetMonth.categoryGroups.flatMap((group: any) => group.categories || []);
    
    const fromBudget = allCategories.find((c: any) => c.id === input.fromCategoryId);
    const toBudget = allCategories.find((c: any) => c.id === input.toCategoryId);
    
    if (!fromBudget) {
      throw new Error(`Source category ${input.fromCategoryId} not found in budget`);
    }
    
    if (!toBudget) {
      throw new Error(`Target category ${input.toCategoryId} not found in budget`);
    }
    
    const currentFromAmount = fromBudget.budgeted || 0;
    const currentToAmount = toBudget.budgeted || 0;
    
    // Check if source has enough budget
    if (currentFromAmount < input.amount) {
      throw new Error(
        `Insufficient budget in source category. Available: ${currentFromAmount}, Requested: ${input.amount}`
      );
    }
    
    // Perform the transfer using batch updates for atomicity
    await adapter.batchBudgetUpdates(async () => {
      await adapter.setBudgetAmount(input.month, input.fromCategoryId, currentFromAmount - input.amount);
      await adapter.setBudgetAmount(input.month, input.toCategoryId, currentToAmount + input.amount);
    });
    
    return {
      result: {
        success: true,
        transferred: input.amount,
        fromCategory: {
          id: input.fromCategoryId,
          previousAmount: currentFromAmount,
          newAmount: currentFromAmount - input.amount,
        },
        toCategory: {
          id: input.toCategoryId,
          previousAmount: currentToAmount,
          newAmount: currentToAmount + input.amount,
        },
      },
    };
  },
};

export default tool;
