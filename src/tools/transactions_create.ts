import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  accountId: z.string().describe('Account ID to post transaction to'),
  amount: z.number().describe('Amount in the account currency'),
  payee: z.string().optional(),
  date: z.string().optional(),
});

type Output = any; // TODO: refine using paths['/transactions']['post']['responses']['200']

const tool: ToolDefinition = {
  name: 'actual.transactions.create',
  description: "Create a transaction",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // validate input
    const input = InputSchema.parse(args ?? {});
    // Call the actual API to create a transaction (wrap single tx in array)
    const tx = await adapter.addTransactions([input]);
    return { result: tx };
  },
};

export default tool;
