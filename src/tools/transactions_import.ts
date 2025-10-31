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
  call: async (args: any, _meta?: any) => {
    const input = InputSchema.parse(args || {});
    // expect input to be { accountId, transactions }
    // if caller passed { accountId, transactions } or an array, try to call accordingly
    if (Array.isArray(input)) {
      const res = await adapter.importTransactions(undefined, input);
      return { result: res };
    }
    const accountId = (input as any).accountId ?? undefined;
    const txs = (input as any).transactions ?? (input as any);
    const res = await adapter.importTransactions(accountId, txs);
    return { result: res };

  },
};

export default tool;
