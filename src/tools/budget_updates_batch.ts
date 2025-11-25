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
  description: `Perform multiple budget updates in a single batch operation. More efficient than individual calls for bulk budget changes.

Use cases:
- Set budget amounts for multiple months/categories at once
- Copy budgets across time periods
- Bulk budget initialization

Limits: Recommended max 50 operations per batch to avoid timeouts.

Example: Set health insurance budget for 12 months:
{
  "operations": [
    {"month": "2025-01", "categoryId": "<uuid>", "amount": 50000},
    {"month": "2025-02", "categoryId": "<uuid>", "amount": 50000}
  ]
}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Validate operation count
    if (input.operations.length > 100) {
      throw new Error(`Too many operations (${input.operations.length}). Maximum 100 per batch. Split into multiple batches.`);
    }
    
    if (input.operations.length > 50) {
      console.warn(`Large batch (${input.operations.length} operations). Consider splitting for better reliability.`);
    }
    
    // Track successes and failures
    const results = { successful: 0, failed: 0, errors: [] as string[] };
    
    await adapter.batchBudgetUpdates(async () => {
      for (let i = 0; i < input.operations.length; i++) {
        const op = input.operations[i];
        try {
          if (op.amount !== undefined) {
            await adapter.setBudgetAmount(op.month, op.categoryId, op.amount);
          }
          if (op.carryover !== undefined) {
            await adapter.setBudgetCarryover(op.month, op.categoryId, op.carryover);
          }
          results.successful++;
        } catch (error) {
          results.failed++;
          const errorMsg = `Operation ${i + 1} failed (month: ${op.month}, category: ${op.categoryId}): ${(error as Error).message}`;
          results.errors.push(errorMsg);
          console.error(errorMsg);
          // Continue processing remaining operations
        }
      }
    });
    
    return { 
      success: results.failed === 0,
      totalOperations: input.operations.length,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors.length > 0 ? results.errors.slice(0, 5) : undefined, // Return first 5 errors
    };
  },
};

export default tool;
