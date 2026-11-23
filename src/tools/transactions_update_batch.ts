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
 * - No wrapToolCall: uses direct call() pattern
 * - Returns a plain BatchResult object (no { result } wrapper)
 */
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas, TX_UPDATE_NEEDS_A_FIELD, hasFieldToChange } from '../lib/schemas/common.js';

const FieldsSchema = z.object({
  account: z.string().optional().describe('Account ID'),
  date: CommonSchemas.date.optional().describe('Transaction date (YYYY-MM-DD)'),
  amount: z.number().optional().describe('Amount in cents (e.g., -1000 = -$10.00)'),
  payee: z.string().nullable().optional().describe('Payee ID; null clears'),
  payee_name: z.string().nullable().optional().describe('Payee name; found or created'),
  imported_payee: z.string().nullable().optional().describe('Original imported payee name'),
  category: z.string().nullable().optional().describe('Category ID'),
  notes: z.string().nullable().optional().describe('Transaction notes'),
  cleared: z.boolean().nullable().optional().describe('Whether transaction is cleared'),
})
  // #815: strict, so an unknown key (and subtransactions, imported_id, reconciled, transfer_id,
  // which were stripped silently) is refused; and an item that changes nothing is refused.
  .strict()
  .refine((v) => hasFieldToChange(v, ''), { message: TX_UPDATE_NEEDS_A_FIELD });

const UpdateItemSchema = z.object({
  id: CommonSchemas.transactionId.describe('Transaction ID to update'),
  fields: FieldsSchema.describe('Fields to update for this transaction'),
});

const InputSchema = z.object({
  updates:  z.array(UpdateItemSchema)
    .min(1)
    .max(50)
    .describe('Array of {id, fields} objects. Maximum 50 per batch (higher values risk timeout).'),
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
  description: `Update multiple transactions in a single call. Accepts up to 50 {id, fields} pairs. Each update is applied independently and NOT atomically: items applied before a failure stay applied. A missing id, an unknown payee or category id or an update Actual rejects is reported per item in failed, and the rest continue. If the call itself fails (lost connection, out of memory, timeout), the error names the ids already applied; read the transactions back with actual_transactions_get BEFORE retrying. An item whose error says "not attempted" was never sent, because the batch ran out of time; read back before retrying it too, since others may have been applied. Each item accepts only the listed fields and needs at least one. Splits are not supported here: use actual_transactions_update to split a transaction or edit a split's children. An amount change on a split parent or child is refused per item.

Returns: { succeeded: [{id}], failed: [{id, error}], total, successCount, failureCount }

Example: { updates: [{ id: "txn-uuid-1", fields: { category: "cat-uuid" } }, { id: "txn-uuid-2", fields: { notes: "Reimbursement" } }] }`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // No catch-all here (#517): a ZodError must reach actualToolsManager.callTool, which
    // formats it, and a whole-call failure (no budget, timeout, lock) must surface as a
    // tool error. Wrapping either as failed: [{id: 'batch'}] read as a per-item outcome.
    const input = InputSchema.parse(args || {});

    // Single adapter call: all updates share one init/sync/shutdown cycle (fixes issue #79).
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
