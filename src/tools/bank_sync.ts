import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { BANK_SYNC_IDS_CAP } from '../lib/constants.js';

const InputSchema = z.object({
  accountId: z.string().nullable().optional().describe('Optional account ID to sync a specific account. If omitted, syncs all linked accounts.'),
});


const tool: ToolDefinition = {
  name: 'actual_bank_sync',
  description:
    'Run 3rd party bank sync (GoCardless, SimpleFIN) for one linked account, or for every linked open account when accountId is omitted. ' +
    'Refuses at once for a local, closed, half-linked or unknown account, or when no open account is linked. ' +
    'Reports what Actual reconciled: newTransactions (imported), matchedTransactions (existing ones updated) and updatedAccounts (accounts that received new transactions), ' +
    `each as { count, ids } with up to ${BANK_SYNC_IDS_CAP} ids (count is always the full total; truncated is true when any list was cut). ` +
    'Never retried. A sync that runs past the server operation timeout reports "timed out" and may still have imported, so re-list transactions before retrying. ' +
    'An all-accounts sync that fails on one account may still have imported the others; those imports reach the Actual server with the next write in this session or when it closes, so other clients may not see them yet.',

  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // #388: the one Category B field where `verifyExists: true` is worth a listing read on the
    // HAPPY path too. Every other filter id costs at most a wrong-looking local result; this one
    // reaches a THIRD PARTY, so an id that names nothing spends a provider call (and, with
    // GoCardless, part of a rate-limited quota) to accomplish nothing. Omitting accountId still
    // means "sync everything" and is not validated, because there is nothing to validate.
    if (input.accountId) {
      await adapter.resolveFilterId('account', input.accountId, { verifyExists: true });
    }
    // #548: rethrow the adapter's error as is, so a typed refusal keeps its brand.
    const report = await adapter.runBankSync(input.accountId ?? undefined);
    let truncated = false;
    const capped = (ids: string[]) => {
      if (ids.length > BANK_SYNC_IDS_CAP) truncated = true;
      return { count: ids.length, ids: ids.slice(0, BANK_SYNC_IDS_CAP) };
    };
    return {
      result: 'Bank sync completed',
      newTransactions: capped(report.newTransactions),
      matchedTransactions: capped(report.matchedTransactions),
      updatedAccounts: capped(report.updatedAccounts),
      truncated,
    };
  },
};

export default tool;
