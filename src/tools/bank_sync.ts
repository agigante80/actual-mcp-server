import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  accountId: z.string().nullable().optional().describe('Optional account ID to sync a specific account. If omitted, syncs all linked accounts.'),
});

type Output = void;

const tool: ToolDefinition = {
  name: 'actual_bank_sync',
  description: 'Trigger 3rd party bank sync (GoCardless, SimpleFIN) for linked bank accounts. This initiates a sync to pull new transactions from connected banks.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.runBankSync(input.accountId ?? undefined);
    return { result: 'Bank sync initiated successfully' };
  },
};

export default tool;
