import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  // Bounded, because the id is echoed into the error message and into the structured
  // logs. Not tightened to CommonSchemas.accountId (a UUID) here: several fixtures use
  // short non-UUID ids, and that sweep is tracked separately alongside #365.
  id: z.string().min(1).max(64).describe('Account ID to reopen'),
});

/**
 * #358. The guard lives in `adapter.reopenAccount`, which reads, writes and re-reads inside
 * one write-queue cycle. See that function for why a pre-check is right here and was wrong
 * in #347.
 *
 * #371 moved it there from this file. The read-then-write property never needed the raw
 * api: doing it in the adapter keeps `retry` on the reads, keeps one observability call
 * site, and leaves no unguarded `adapter.reopenAccount` for a future caller to reach for.
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
    await adapter.reopenAccount(input.id);
    return { success: true };
  },
};

export default tool;
