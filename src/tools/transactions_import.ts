import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const TransactionInput = z.object({
  accountId: z.string().optional(),
  amount: z.number().describe('Transaction amount'),
  payee: z.string().optional(),
  date: z.string().describe('Date in YYYY-MM-DD format'),
});

const InputSchema = z.union([
  z.array(TransactionInput),
  z.object({ accountId: z.string().optional(), transactions: z.array(TransactionInput) }),
]);

// RESPONSE_TYPE: object
type Output = { added: string[]; updated: string[]; errors: string[] };

const tool: ToolDefinition = {
  name: 'actual.transactions.import',
  description: "Import transactions (reconcile, avoid duplicates)",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
    const input = InputSchema.parse(args || {});
    // input is either an array of transactions or { accountId?, transactions }
    if (Array.isArray(input)) {
      const res = await adapter.importTransactions(undefined, input as unknown[]);
      return { result: res };
    }
    // object form
    const { accountId, transactions } = input as { accountId?: string; transactions?: Array<unknown> };
    const txs = transactions ?? [];
    const res = await adapter.importTransactions(accountId, txs as unknown[]);
    return { result: res };

  },
};

export default tool;
