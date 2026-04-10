/**
 * actual_transactions_update_batch
 *
 * Batch-update multiple transactions in one call.
 *
 * Concept and implementation adapted from the ZanzyTHEbar fork:
 * https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/transactions_update_batch.ts
 * Credit: ZanzyTHEbar (https://github.com/ZanzyTHEbar)
 *
 * Adapted for this project's conventions:
 * - No wrapToolCall — uses direct call() pattern
 * - Returns a plain BatchResult object (no { result } wrapper)
 */
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const FieldsSchema = z.object({
  account: z.string().nullable().optional().describe('Account ID'),
  date: z.string().nullable().optional().describe('Transaction date (YYYY-MM-DD)'),
  amount: z.number().nullable().optional().describe('Amount in cents (e.g., -1000 = -$10.00)'),
  payee: z.string().nullable().optional().describe('Payee ID'),
  payee_name: z.string().nullable().optional().describe('Payee name (alternative to payee ID)'),
  imported_payee: z.string().nullable().optional().describe('Original imported payee name'),
  category: z.string().nullable().optional().describe('Category ID'),
  notes: z.string().nullable().optional().describe('Transaction notes'),
  cleared: z.boolean().nullable().optional().describe('Whether transaction is cleared'),
});

const UpdateItemSchema = z.object({
  id: z.string().describe('Transaction ID to update'),
  fields: FieldsSchema.describe('Fields to update for this transaction'),
});

const InputSchema = z.object({
  updates: z.array(UpdateItemSchema)
    .min(1)
    .max(100)
    .describe('Array of {id, fields} objects. Maximum 100 per batch.'),
});

type BatchResult = {
  succeeded: { id: string }[];
  failed: { id: string; error: string }[];
  total: number;
  successCount: number;
  failureCount: number;
};

const tool: ToolDefinition = {
  name: 'actual_transactions_update_batch',
  description: `Update multiple transactions in a single call. Accepts up to 100 {id, fields} pairs. Each update is applied independently — partial failures are reported per-item so you know exactly which succeeded and which failed.

Returns: { succeeded: [{id}], failed: [{id, error}], total, successCount, failureCount }

Example: { updates: [{ id: "txn-uuid-1", fields: { category: "cat-uuid" } }, { id: "txn-uuid-2", fields: { notes: "Reimbursement" } }] }`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    // Single adapter call — all updates share one init/sync/shutdown cycle (fixes issue #79).
    // Calling adapter.updateTransaction() in a loop would trigger N separate budget sessions.
    const { succeeded, failed } = await adapter.updateTransactionBatch(input.updates);

    const result: BatchResult = {
      succeeded,
      failed,
      total: input.updates.length,
      successCount: succeeded.length,
      failureCount: failed.length,
    };

    return result;
  },
};

export default tool;
