import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

// A single transaction to import. `date` and `amount` (cents) are required by the
// Actual API; everything else is optional. `.passthrough()` keeps the tool flexible
// for any extra fields @actual-app/api accepts (imported_payee, subtransactions, …),
// preserving the original "light validation" intent — while still giving MCP clients
// a concrete shape to serialise the array against (an empty `z.unknown()` schema does
// not, which made this tool unusable from stdio clients).
const ImportTransactionSchema = z
  .object({
    date: CommonSchemas.date,
    amount: CommonSchemas.amountCents,
    payee: CommonSchemas.payeeId.optional(),
    payee_name: z.string().optional().describe('Payee name (alternative to payee ID)'),
    category: CommonSchemas.categoryId.optional(),
    notes: CommonSchemas.notes,
    cleared: CommonSchemas.cleared,
    imported_id: z.string().optional().describe('Stable external ID used for de-duplication/reconciliation'),
  })
  .passthrough();

// NOTE: Wrapped in z.object() for LibreChat compatibility (requires type: "object")
const InputSchema = z.object({
  accountId: z
    .string()
    .optional()
    .describe('Destination account ID to import into. Provide for normal bank-statement imports; omitting it can create transactions with no account.'),
  txs: z
    .array(ImportTransactionSchema)
    .describe('Transactions to import. Each item requires `date` (YYYY-MM-DD) and `amount` (in cents). De-duplication is by `imported_id`.'),
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
