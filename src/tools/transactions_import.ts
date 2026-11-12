import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

// A single transaction to import. `date` and `amount` are required; the rest are optional.
// `looseObject` keeps the schema OPEN (additionalProperties is not false) so legitimate
// Actual `TransactionInput` fields that are not enumerated here (e.g. `subtransactions`,
// `transfer_id`, `reconciled`) are passed through rather than rejected. (#217)
const TxItemSchema = z.looseObject({
  date: CommonSchemas.date,
  amount: CommonSchemas.amountCents,
  payee: CommonSchemas.payeeId.optional(),
  payee_name: z.string().optional().describe('Payee name (alternative to payee ID)'),
  imported_payee: z.string().optional().describe('Original payee name from the source'),
  category: CommonSchemas.categoryId.optional(),
  notes: CommonSchemas.notes,
  cleared: CommonSchemas.cleared,
  imported_id: z.string().optional().describe('Stable source ID; used to de-duplicate on re-import'),
});

// #217: `txs` was previously `z.unknown()`, which serialised to an empty `{}` JSON Schema in
// `tools/list`. Schema-driven MCP clients then had no shape for `txs` and sent it in a form
// the handler could not use, so `@actual-app/api` threw "`date` is required when adding a
// transaction" even for valid payloads. Typing it as an array of `TxItemSchema` publishes a
// proper `type: "array"` schema and makes the tool usable from those clients.
const InputSchema = z.object({
  accountId: CommonSchemas.accountId.describe('Destination account UUID to import into'),
  txs: z
    .array(TxItemSchema)
    .min(1)
    .describe('Transactions to import. Each requires date (YYYY-MM-DD) and amount (integer cents).'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_import',
  description:
    "Import a batch of transactions into one account (accountId) the way a bank file is imported: rules are applied, and each row is matched against the account's transactions so a match is not duplicated: by imported_id, else by the same amount within 7 days (two rows that both carry an imported_id never match this way). A match keeps the payee, category and notes it has and only fills blanks, so re-importing does not correct a row. For a few hand-entered rows use actual_transactions_create. Returns { result: { added, updated, errors } }, the ids added and updated.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const parsed = InputSchema.parse(args || {});
    const result = await adapter.importTransactions(parsed.accountId, parsed.txs);
    return { result };
  },
};

export default tool;
