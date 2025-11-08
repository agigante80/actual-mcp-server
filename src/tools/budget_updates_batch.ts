import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const BudgetOperationSchema = z.object({
  month: z.string().describe('Budget month in YYYY-MM format'),
  categoryId: z.string().describe('Category ID'),
  amount: z.number().optional().describe('Budget amount in cents (if setting amount)'),
  carryover: z.boolean().optional().describe('Carryover flag (if setting carryover)'),
});

const InputSchema = z.object({
  operations: z.array(BudgetOperationSchema).describe('Array of budget operations to perform in batch'),
});

const tool: ToolDefinition = {
  name: 'actual_budget_updates_batch',
  description: `Perform multiple budget updates in a single batch operation. This is more efficient than making individual calls for each budget change. Each operation can set an amount or carryover flag for a category in a specific month.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    await adapter.batchBudgetUpdates(async () => {
      for (const op of input.operations) {
        if (op.amount !== undefined) {
          await adapter.setBudgetAmount(op.month, op.categoryId, op.amount);
        }
        if (op.carryover !== undefined) {
          await adapter.setBudgetCarryover(op.month, op.categoryId, op.carryover);
        }
      }
    });
    
    return { success: true, operationsProcessed: input.operations.length };
  },
};

export default tool;
