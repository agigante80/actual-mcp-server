import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Allow either an object with accountId and txs, or raw tx array/object — keep validation light
const InputSchema = z.union([
  z.object({ accountId: z.string().optional(), txs: z.unknown() }),
  z.unknown(),
]);

// RESPONSE_TYPE: object
type Output = any; // refine using generated types (paths['/transactions/import']['post'])

const tool: ToolDefinition = {
  name: 'actual.transactions.import',
  description: "Import transactions (reconcile, avoid duplicates)",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
    const parsed = InputSchema.parse(args || {});
    // allow either { accountId, txs } or raw txs
    let accountId: string | undefined;
    let txs: unknown;
    if (parsed && typeof parsed === 'object' && 'txs' in (parsed as Record<string, unknown>)) {
  accountId = (parsed as any).accountId;
  txs = (parsed as any).txs;
    } else {
      txs = parsed;
    }
  const result = await adapter.importTransactions(accountId, txs);
    return { result };

  },
};

export default tool;
