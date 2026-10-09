import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { createModuleLogger } from '../lib/loggerFactory.js';

const log = createModuleLogger('BUDGET_BATCH');

const BudgetOperationSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format (e.g. 2025-01)').describe('Budget month in YYYY-MM format'),
    categoryId: CommonSchemas.categoryId.describe('Category ID'),
    amount: CommonSchemas.amountCents.optional().describe('Budget amount in integer cents (if setting amount)'),
    carryover: z.boolean().optional().describe('Carryover flag (if setting carryover)'),
  })
  .refine((op) => op.amount !== undefined || op.carryover !== undefined, {
    message: 'each operation needs at least one of amount or carryover',
  });

const InputSchema = z.object({
  operations: z.array(BudgetOperationSchema).min(1).max(100).describe('Array of 1 to 100 budget operations to perform in batch'),
});

type BatchResult = {
  succeeded: { index: number; month: string; categoryId: string }[];
  failed: { index: number; month: string; categoryId: string; error: string }[];
  total: number;
  successCount: number;
  failureCount: number;
};

// Legacy ToolDefinition (like its sibling actual_transactions_update_batch): this is a
// correctness fix, and a createTool() migration would widen the diff with no benefit to it.
// The guards, the single write cycle and the raw writes all live in adapter.setBudgetBatch;
// this file never imports @actual-app/api and never writes directly (AGENTS.md).
const tool: ToolDefinition = {
  name: 'actual_budget_updates_batch',
  description: `Set budget amounts and/or carryover flags for many month/category pairs in one call. Accepts 1 to 100 operations; each operation needs at least one of amount (integer cents) or carryover (boolean).

Each operation is applied independently and NOT atomically: there is no rollback, so items applied before a failure stay applied. An unknown category, a month outside the budget's range, or a carryover on an income category fails only that item and is reported per item. If an operation sets both amount and carryover and the carryover fails, the amount may already be applied. If the call times out, read the affected months back with actual_budgets_getMonth BEFORE retrying; some items may have been applied. If several items target the same month and category, the last one wins.

Returns: { succeeded: [{index, month, categoryId}], failed: [{index, month, categoryId, error}], total, successCount, failureCount }. Every item failing is a normal result (successCount 0), not a tool error. To rebalance categories, read the month with actual_budgets_getMonth, then send one batch of absolute amounts.

Example: Set health insurance budget for 2 months:
{
  "operations": [
    {"month": "2025-01", "categoryId": "<uuid>", "amount": 50000},
    {"month": "2025-02", "categoryId": "<uuid>", "amount": 50000}
  ]
}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // No catch-all (#517): a ZodError or a whole-call failure (budget precondition, lock,
    // timeout) must reach actualToolsManager.callTool and surface as a tool error.
    const input = InputSchema.parse(args || {});
    const { succeeded, failed } = await adapter.setBudgetBatch(input.operations);

    // Counts and failed indices only. Never amounts, months or category ids.
    log.info('Budget batch finished', {
      total: input.operations.length,
      successCount: succeeded.length,
      failureCount: failed.length,
    });
    if (failed.length > 0) {
      // setBudgetBatch returns `failed` already sorted ascending by index, so no re-sort here.
      const failedIndices = failed.map((f) => f.index);
      log.warn('Budget batch items failed', { failureCount: failed.length, failedIndices });
    }

    const result: BatchResult = {
      succeeded,
      failed,
      total: input.operations.length,
      successCount: succeeded.length,
      failureCount: failed.length,
    };
    return result;
  },
};

export default tool;
