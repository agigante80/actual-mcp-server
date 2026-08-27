import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  // Bounded, because the id is echoed into the error message and into the structured
  // logs. Not tightened to CommonSchemas.accountId (a UUID) here: several fixtures use
  // short non-UUID ids, and that sweep is tracked separately alongside #365.
  id: CommonSchemas.accountId.describe('Account ID to reopen'),
});

/**
 * #358. The guard lives in `adapter.reopenAccount`, which reads, writes and re-reads inside
 * one write-queue cycle. See that function for why a pre-check is right here and was wrong
 * in #347.
 *
 * #371 moved it there from this file. The read-then-write property never needed the raw
 * api: doing it in the adapter keeps `retry` on the reads, keeps one observability call
 * site, and leaves no unguarded `adapter.reopenAccount` for a future caller to reach for.
 *
 * #369 item 5: an already-open account is now reported as a non-change and issues NO write.
 * Upstream's reopen is a db.update, which in Actual is a CRDT message that syncs to every
 * client, so a no-op write is real sync traffic.
 */
const tool: ToolDefinition = {
  name: 'actual_accounts_reopen',
  description:
    'Reopen a previously closed account in Actual Budget. The account becomes active again and ' +
    'visible in all views, and all historical transactions remain intact. An id that is not an ' +
    'account is refused: Actual would otherwise create an empty account under that id. Note that ' +
    'an account closed while it had NO transactions was removed by Actual, not closed, and ' +
    'cannot be reopened. Reopening an account that is already open reports that rather than ' +
    'claiming a change, and issues no write. ' +
    'If this call reports an error, re-read the account with actual_accounts_list before ' +
    'retrying: the state is verified AFTER the write, so a failure of that verification read ' +
    'is reported even though the reopen itself may have succeeded.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.reopenAccount(input.id);

    if (result.outcome === 'already-open') {
      return {
        success: true as const,
        alreadyOpen: true as const,
        message: `Account "${result.name ?? input.id}" was already open. Nothing changed.`,
      };
    }
    return { success: true as const, reopened: true as const };
  },
};

export default tool;
