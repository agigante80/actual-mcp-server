import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import * as observability from '../observability.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getAccounts: rawGetAccounts, getCategories: rawGetCategories, closeAccount: rawCloseAccount } = api as any;

const InputSchema = z
  .object({
    id: z.string().min(1).max(64).describe('Account ID to close'),
    // #357: documented by the Actual API reference as required when the account's
    // balance is non-zero, and previously not exposed at all, which made such an
    // account impossible to close through this server.
    transferAccountId: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'Account ID to move the remaining balance to. REQUIRED when the account has a non-zero balance.',
      ),
    transferCategoryId: z
      .string()
      .min(1)
      .max(64)
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

type AccountRow = { id?: string; name?: string; closed?: boolean };

/**
 * #357: three defects on one code path, fixed together because any one of them
 * rewrites this handler.
 *
 * (a) FALSE SUCCESS. Upstream `closeAccount` opens with
 *     `if (!account || account.closed === 1) { return; }`, so closing an unknown id
 *     or an already-closed account did nothing and reported success. Same upstream
 *     early-return that produced #347.
 *
 * (b) CLOSE CAN DELETE. `if (numTransactions === 0) { await db.deleteAccount({id}); }`.
 *     An account with no transactions is TOMBSTONED rather than closed, it disappears
 *     from every listing, and `actual_accounts_reopen` cannot bring it back. The old
 *     description promised "their transaction history is preserved", which is false in
 *     exactly this case. The repo already knew: tests/manual/tests/account.js adds a
 *     dummy transaction with a comment explaining it.
 *
 * (c) A BALANCE MADE IT UNCLOSABLE. `transferAccountId` and `transferCategoryId` are
 *     documented parameters, the schema did not accept them, and upstream throws
 *     `balance is non-zero: transferAccountId is required` without them. The caller
 *     was told to supply something no tool would take.
 *
 * The read, the write and the verification run inside ONE `withWriteSession` cycle
 * (#142). A read-BEFORE is required here, unlike #347's pure verify-after, because (b)
 * makes "absent afterwards" ambiguous: an account deleted by the close and an id that
 * never existed look identical from a single post-read.
 *
 * Going through the raw api inside the session means this path no longer gets the
 * adapter's `retry`. That is inherent to the #142 pattern, shared with every tool using
 * it, and it is the half of #368 that still stands. The per-tool counter is NOT lost:
 * it is incremented in the handler below.
 *
 * Already-closed is reported as success rather than as an error, deliberately. The
 * caller's intent ("this account should be closed") is already satisfied, which is the
 * same idempotence argument #347 used for delete. What changes is that the response no
 * longer CLAIMS a state change that did not happen.
 */
const tool: ToolDefinition = {
  name: 'actual_accounts_close',
  description:
    'Mark an account as closed in Actual Budget. Closed accounts are hidden from most views. ' +
    'IMPORTANT: an account with NO transactions is REMOVED by Actual rather than closed, and cannot ' +
    'be reopened; an account that has transactions keeps them. If the account has a non-zero balance, ' +
    'transferAccountId is required and the remaining balance is moved there as a dated "Closing account" ' +
    'transaction. Closing an already-closed account reports that rather than claiming a change.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // #368: the adapter method that used to own this counter is no longer on the path,
    // because this tool reads and writes through the raw api inside one session. Counting
    // here keeps `actual.accounts.close` honest; the retry half of #368 still stands.
    observability.incrementToolCall('actual.accounts.close').catch(() => {});

    return await adapter.withWriteSession(async () => {
      const before = (await rawGetAccounts()) as AccountRow[];
      const target = Array.isArray(before) ? before.find((a) => a?.id === input.id) : undefined;

      if (!target) {
        throw new Error(
          `Account "${input.id}" not found. Use actual_accounts_list to see the accounts that ` +
            'exist. Note that an account closed while it had no transactions was REMOVED by ' +
            'Actual, not closed, so it will not appear there.',
        );
      }

      if (target.closed === true) {
        // Idempotent and truthful: the requested state already holds, and the response
        // says so instead of implying this call changed anything.
        return {
          success: true as const,
          alreadyClosed: true as const,
          message: `Account "${target.name ?? input.id}" was already closed. Nothing changed.`,
        };
      }

      if (input.transferAccountId) {
        const destination = Array.isArray(before)
          ? before.find((a) => a?.id === input.transferAccountId)
          : undefined;
        if (!destination) {
          throw new Error(
            `Transfer destination account "${input.transferAccountId}" not found. Use ` +
              'actual_accounts_list to pick an account to move the remaining balance to.',
          );
        }
        if (destination.closed === true) {
          // The balancing transaction would land in a closed account, where it is hidden
          // from most views. Upstream does not stop this; refusing is the kinder answer.
          throw new Error(
            `Transfer destination account "${destination.name ?? input.transferAccountId}" is ` +
              'CLOSED, so the closing balance would be moved somewhere hidden from most views. ' +
              'Pick an open account, or reopen that one with actual_accounts_reopen first.',
          );
        }
      }

      if (input.transferCategoryId) {
        // #359's lesson, applied to the only NEW write this change adds. Upstream forwards
        // this id straight into `transaction-add` without checking it (api.ts's
        // account-close passes it as `categoryId`, and addTransaction is a bare batch
        // update), so a bogus value writes a "Closing account" transaction carrying a
        // category that does not exist, and syncs it to every client. Same dangling
        // reference the transactions_create guard exists to prevent.
        const categories = (await rawGetCategories()) as Array<{ id?: string }>;
        const categoryExists = Array.isArray(categories)
          ? categories.some((c) => c?.id === input.transferCategoryId)
          : false;
        if (!categoryExists) {
          throw new Error(
            `Transfer category "${input.transferCategoryId}" not found. Use ` +
              'actual_categories_get to pick a category for the closing transaction, or omit ' +
              'transferCategoryId to leave it uncategorised.',
          );
        }
      }

      try {
        await rawCloseAccount(input.id, input.transferAccountId, input.transferCategoryId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/balance is non-zero/i.test(msg)) {
          // Translate upstream's message into one the caller can act on, now that the
          // parameter it asks for actually exists on this tool.
          throw new Error(
            `Account "${target.name ?? input.id}" has a non-zero balance, so closing it requires ` +
              'transferAccountId: the id of the account to move the remaining balance to. ' +
              'Optionally pass transferCategoryId to categorise the balancing transaction. ' +
              'Use actual_accounts_list to pick a destination.',
          );
        }
        throw err;
      }

      // Verify the effect rather than the call returning (#347).
      const after = (await rawGetAccounts()) as AccountRow[];
      const survivor = Array.isArray(after) ? after.find((a) => a?.id === input.id) : undefined;

      if (!survivor) {
        // Defect (b): upstream tombstones a zero-transaction account instead of closing
        // it. Saying so is the whole point; the old description claimed the opposite.
        return {
          success: true as const,
          removed: true as const,
          message:
            `Account "${target.name ?? input.id}" had no transactions, so Actual REMOVED it ` +
            'rather than closing it. It will not appear in actual_accounts_list and cannot be ' +
            'reopened.',
        };
      }

      if (survivor.closed !== true) {
        throw new Error(
          `Account "${survivor.name ?? input.id}" (${input.id}) is still open after the close. ` +
            'The call was accepted but had no effect; check the account state in Actual.',
        );
      }

      return { success: true as const, closed: true as const };
    });
  },
};

export default tool;
