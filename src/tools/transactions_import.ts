import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Allow either an object with accountId and txs, or raw tx array/object — keep validation light
// NOTE: Wrapped in z.object() for LibreChat compatibility (requires type: "object")
const InputSchema = z.object({
  accountId: z.string().optional(),
  txs: z.unknown(),
});

// RESPONSE_TYPE: object
type Output = unknown; // refine using generated types (paths['/transactions/import']['post'])

const tool: ToolDefinition = {
  name: 'actual_transactions_import',
  description: "Bulk import transactions with automatic reconciliation and duplicate detection. Matches against existing transactions using imported_id to prevent duplicates. Ideal for importing bank statements, CSV files, or syncing from external sources. Automatically applies budget rules.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const parsed = InputSchema.parse(args || {});
    const accountId = parsed.accountId;
    const txs = parsed.txs;
    const result = await adapter.importTransactions(accountId, txs);
    return { result };
  },
};

export default tool;
