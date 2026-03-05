import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  accountId: z.string().nullable().optional().describe('Optional account ID to sync a specific account. If omitted, syncs all linked accounts.'),
});

type Output = void;

const tool: ToolDefinition = {
  name: 'actual_bank_sync',
  description: 'Trigger 3rd party bank sync (GoCardless, SimpleFIN) for linked bank accounts. Waits up to 10 seconds for the provider to confirm the operation, then returns the result. Provider errors such as rate limits or auth failures are reported if they occur within that window. Successful syncs may take a few additional moments for transactions to appear in Actual Budget.',

  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
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
