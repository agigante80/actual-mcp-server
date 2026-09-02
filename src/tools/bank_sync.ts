import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  accountId: z.string().nullable().optional().describe('Optional account ID to sync a specific account. If omitted, syncs all linked accounts.'),
});


const tool: ToolDefinition = {
  name: 'actual_bank_sync',
  description: 'Trigger 3rd party bank sync (GoCardless, SimpleFIN) for linked bank accounts. Returns immediately with an error if no bank-linked accounts are found. When bank-linked accounts exist, waits up to 30 seconds for the provider to confirm the operation and surfaces errors such as rate limits or auth failures that occur within that window. Successful syncs may take a few additional moments for transactions to appear in Actual Budget.',

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
    try {
      await adapter.runBankSync(input.accountId ?? undefined);
      return { result: 'Bank sync initiated successfully' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(msg);
    }
  },
};

export default tool;
