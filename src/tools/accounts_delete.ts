import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Account ID to delete'),
});

/**
 * #347: this tool used to return `{success: true}` unconditionally, which was a
 * lie for CLOSED accounts.
 *
 * Verified in upstream source. `api.deleteAccount(id)` maps to
 * `account-close({id, forced: true})`, and `closeAccount` opens with:
 *
 *   const account = await db.first('SELECT * FROM accounts WHERE id = ? AND tombstone = 0', [id]);
 *   if (!account || account.closed === 1) return;      // <- silent no-op
 *
 * So a closed account is a no-op with no error, and the tool reported success
 * anyway. Confirmed against a live server: nine deletions all reported success
 * and the seven closed ones survived.
 *
 * WHY VERIFY AFTER, NOT CHECK BEFORE. The obvious fix is to look the account up
 * first and refuse if it is closed. That breaks a case which looks identical from
 * here but is not: `closeAccount` DELETES (tombstones) an account that has zero
 * transactions, and `reopenAccount` only clears the `closed` flag, never the
 * tombstone. `getAccounts()` filters `tombstone = 0`, so a close-then-reopen
 * leaves an id that no longer appears in any listing. A pre-check would call that
 * "not found" and throw, where the caller's intent (make this account not exist)
 * is in fact already satisfied. The repo's own teardown idiom does exactly this:
 * close first, then delete.
 *
 * Verifying AFTER answers the question the caller actually asked, "is it gone?",
 * rather than a proxy for it. It also closes a race the pre-check could not: the
 * read and the write land in different sessions, so a concurrent close could
 * commit between them and reproduce the original false success.
 *
 * The deliberate consequence is that deleting an id that never existed still
 * reports success. That is idempotent-delete semantics, it matches the behaviour
 * before this change, and the post-condition ("no account with this id exists")
 * is true either way.
 */
const tool: ToolDefinition = {
  name: 'actual_accounts_delete',
  description:
    'Delete an account from Actual Budget. DESTRUCTIVE: if the account has transactions, they are ' +
    'deleted too, paired transfer transactions are unlinked, and the transfer payee is removed. This ' +
    'cannot be undone. A CLOSED account cannot be deleted (Actual silently ignores it): reopen it with ' +
    'actual_accounts_reopen first. Deleting an account that does not exist reports success.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});

    await adapter.deleteAccount(input.id);

    // The verification the old code skipped. One read, after the write, so the
    // success claim is about the observed state rather than about the call having
    // returned.
    const remaining = (await adapter.getAccounts()) as Array<{ id?: string; name?: string; closed?: boolean }>;
    const survivor = Array.isArray(remaining) ? remaining.find((a) => a?.id === input.id) : undefined;

    if (survivor) {
      // Reachable when the account is closed: upstream returned without acting.
      // Anything else that leaves it present is equally worth surfacing, so the
      // message covers the general case and names the likely one.
      throw new Error(
        `Account "${survivor.name ?? input.id}" (${input.id}) still exists after the delete` +
          (survivor.closed === true
            ? ': it is CLOSED, and Actual silently ignores a delete on a closed account. Reopen it with ' +
              'actual_accounts_reopen and delete it again, or leave it closed if you only wanted it out of the way.'
            : '. The delete was accepted but had no effect; check the account state in Actual.'),
      );
    }

    return { success: true };
  },
};

export default tool;
