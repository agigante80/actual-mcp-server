import { z } from 'zod';
import type { ToolDefinitionWithOutput } from '../lib/tool-output.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { notFoundMsg } from '../lib/errors.js';

const InputSchema = z.object({ 
  id: CommonSchemas.accountId.describe('The UUID of the account'),
  cutoff: z.string().optional().describe('Optional cutoff date (YYYY-MM-DD format)')
}).strict();

// #642: ONE flat object admitting both result shapes (a union would publish a root anyOf
// with no `type`, which the MCP SDK rejects). `error` is set only when `balance` is null; the
// flat schema does not enforce that pairing.
const OutputSchema = z.object({
  balance: z.number().int().nullable().describe('Account balance in integer cents; null when the account was not found'),
  accountName: z.string().optional().describe('Account name, present when the account was found'),
  error: z.string().optional().describe('Not-found message; set only when balance is null'),
}).loose();

const tool: ToolDefinitionWithOutput = {
  name: 'actual_accounts_get_balance',
  description: `Get the current balance of a specific account.

Required:
- id: Account UUID

Optional:
- cutoff: Date to calculate balance up to (YYYY-MM-DD format)

Returns the account balance as a number (in cents), or an error if the account does not exist.

Example:
{
  "id": "791f738b-847b-48cc-b32b-bbcf2bc8314f"
}`,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Pre-flight: verify account exists (BUG-5)
    const accounts = await adapter.getAccounts();
    const account = (accounts as any[]).find((a: any) => a.id === input.id);
    if (!account) {
      return {
        error: notFoundMsg('Account', input.id, 'actual_accounts_list'),
        balance: null,
      };
    }
    const result = await adapter.getAccountBalance(input.id, input.cutoff);
    return { balance: result, accountName: account.name };
  },
};

export default tool;
