import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z
  .object({
    id: CommonSchemas.accountId.describe('Account ID to close'),
    // #357: documented by the Actual API reference as required when the account's
    // balance is non-zero, and previously not exposed at all, which made such an
    // account impossible to close through this server.
    // #380: the same entity type as `id` three lines up, so it gets the same schema. It was
    // left on a bounded string because the drift guard could not SEE it: its detector
    // required `z.` on the field's own line, and this declaration breaks after `z`.
    transferAccountId: CommonSchemas.accountId
      .optional()
      .describe(
        'Account ID to move the remaining balance to. REQUIRED when the account has a non-zero balance.',
      ),
    transferCategoryId: CommonSchemas.categoryId
      .optional()
      .describe('Category to assign the balancing transaction to. Optional, used with transferAccountId.'),
  })
  .superRefine((val, ctx) => {
    if (val.transferAccountId && val.transferAccountId === val.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transferAccountId'],
        message: 'transferAccountId must be a different account from the one being closed',
      });
    }
  });

/**
 * #357. The three defects (silent no-op on unknown or already-closed, close-deletes a
 * zero-transaction account, and the documented transfer arguments that were not exposed)
 * are handled in `adapter.closeAccount`, which reads, writes and re-reads in one write-queue
 * cycle and returns WHICH of the three outcomes happened.
 *
 * #371 moved that logic there from this file. This tool now owns only the published schema
 * and the response wording, which is where the rest of the tool surface keeps them.
 */
const tool: ToolDefinition = {
  name: 'actual_accounts_close',
  description:
    'Mark an account as closed in Actual Budget. Closed accounts are hidden from most views. ' +
    'IMPORTANT: an account with NO transactions is REMOVED by Actual rather than closed, and cannot ' +
    'be reopened; an account that has transactions keeps them. If the account has a non-zero balance, ' +
    'transferAccountId is required and the remaining balance is moved there as a dated "Closing account" ' +
    'transaction. Closing an already-closed account reports that rather than claiming a change. ' +
    'If this call reports an error, re-read the account with actual_accounts_list before retrying: ' +
    'the state is verified AFTER the write, so a failure of that verification read is reported ' +
    'even though the close itself may have succeeded.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.closeAccount(input.id, input.transferAccountId, input.transferCategoryId);
    const name = result.name ?? input.id;

    switch (result.outcome) {
      case 'already-closed':
        return {
          success: true as const,
          alreadyClosed: true as const,
          message: `Account "${name}" was already closed. Nothing changed.`,
        };
      case 'removed':
        return {
          success: true as const,
          removed: true as const,
          message:
            `Account "${name}" had no transactions, so Actual REMOVED it rather than closing ` +
            'it. It will not appear in actual_accounts_list and cannot be reopened.',
        };
      default:
        return { success: true as const, closed: true as const };
    }
  },
};

export default tool;
