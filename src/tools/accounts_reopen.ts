import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getAccounts: rawGetAccounts, reopenAccount: rawReopenAccount } = api as any;

const InputSchema = z.object({
  id: z.string().describe('Account ID to reopen'),
});

type AccountRow = { id?: string; name?: string; closed?: boolean };

/**
 * #358: this tool used to call reopen and return `{success: true}` unconditionally.
 * For an id that is not an account, that was not merely a false success: it CREATED
 * a nameless account.
 *
 * Verified in upstream source (26.8.0). `reopenAccount` is a bare update:
 *
 *   async function reopenAccount({ id }) { await db.update('accounts', { id, closed: 0 }); }
 *
 * `db.update` does not run a SQL UPDATE. It sends CRDT messages, and `apply()` in
 * loot-core/src/server/sync/index.ts picks INSERT when the row was absent from the
 * pre-read:
 *
 *   INSERT INTO accounts (id, closed) VALUES (?, ?)
 *
 * The accounts table has no NOT NULL columns and `tombstone` defaults to 0, while
 * `getAccounts()` selects `WHERE a.tombstone = 0`. So the phantom row is a fully
 * visible account with a null name, and because it is a CRDT message it SYNCS to
 * every other client on the budget.
 *
 * WHY A PRE-CHECK HERE, WHEN #347 DELIBERATELY REJECTED ONE.
 *
 * The two cases look identical and are not. In #347 the caller's intent ("make this
 * account not exist") could ALREADY be satisfied by an absent row, so refusing on
 * absence would have failed a request that was in fact complete. Here the caller's
 * intent ("reopen this account") cannot possibly be satisfied by an absent row, and
 * proceeding actively creates one. Refusing is the only correct answer.
 *
 * The post-verify is kept as well, so the success claim is about observed state
 * rather than about the call having returned. Read, write and re-read all run inside
 * ONE `withWriteSession` cycle (#142), which also closes the read-then-write race a
 * bare pre-check would leave open.
 */
const tool: ToolDefinition = {
  name: 'actual_accounts_reopen',
  description:
    'Reopen a previously closed account in Actual Budget. The account becomes active again and ' +
    'visible in all views, and all historical transactions remain intact. An id that is not an ' +
    'account is refused: Actual would otherwise create an empty account under that id. Note that ' +
    'an account closed while it had NO transactions was removed by Actual rather than closed, and ' +
    'cannot be reopened.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    return await adapter.withWriteSession(async () => {
      const before = (await rawGetAccounts()) as AccountRow[];
      const target = Array.isArray(before) ? before.find((a) => a?.id === input.id) : undefined;

      if (!target) {
        throw new Error(
          `Account "${input.id}" not found, so it cannot be reopened. Use actual_accounts_list to ` +
            'see the accounts that exist. If this account was closed while it had no transactions, ' +
            'Actual removed it rather than closing it, and it cannot be reopened: create a new one ' +
            'with actual_accounts_create.',
        );
      }

      await rawReopenAccount(input.id);

      // Verify the effect rather than the call returning. Same reasoning as #347.
      const after = (await rawGetAccounts()) as AccountRow[];
      const survivor = Array.isArray(after) ? after.find((a) => a?.id === input.id) : undefined;

      if (!survivor) {
        throw new Error(
          `Account "${input.id}" disappeared while being reopened. Check the account state in Actual.`,
        );
      }
      if (survivor.closed === true) {
        throw new Error(
          `Account "${survivor.name ?? input.id}" (${input.id}) is still closed after the reopen. ` +
            'The call was accepted but had no effect; check the account state in Actual.',
        );
      }

      return { success: true };
    });
  },
};

export default tool;
