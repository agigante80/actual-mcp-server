import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  // #365: the shared payee-id schema, which is the UUID pattern. #356 bounded this at
  // .max(64) (the id is echoed into the error message and the logs) but deliberately
  // stopped short of the regex, because adopting it meant rewriting non-UUID fixtures in
  // two test files and that was not the transfer-payee bug #356 existed to fix. The
  // regex is strictly tighter than the bound it replaces, so the echo is still bounded.
  id: CommonSchemas.payeeId.describe('Payee ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_payees_delete',
  description:
    'Delete a payee from Actual Budget. Transactions using this payee will have it removed. This ' +
    'operation cannot be undone. A TRANSFER payee (the payee Actual creates for each account, named ' +
    'after it) cannot be deleted on its own: the call is refused and points at actual_accounts_delete.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Route through the guarded adapter method (pre-flight existence check), not the
    // raw api.deletePayee. The raw call throws a cryptic "Cannot destructure property
    // 'transfer_acct' of null" on a non-existent id; adapter.deletePayee returns an
    // actionable "Payee not found" instead. adapter.deletePayee already runs inside a
    // single write-queue cycle, preserving the #142 lock invariant.
    await adapter.deletePayee(input.id);
    return { success: true };
  },
};

export default tool;
