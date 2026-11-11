import { z } from 'zod';
import type { ToolDefinitionWithOutput } from '../lib/tool-output.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Account[]

// #642: the published result shape. `.loose()` so an unlisted upstream field still validates;
// balance_current is added by getAccountsWithBalances (integer cents, null when unavailable).
const OutputSchema = z.object({
  result: z.array(z.object({
    id: z.string().describe('Account UUID'),
    name: z.string().describe('Account name'),
    offbudget: z.boolean().optional().describe('True when the account is off budget'),
    closed: z.boolean().optional().describe('True when the account is closed'),
    balance_current: z.number().int().nullable().optional().describe('Current balance in integer cents, null when unavailable'),
  }).loose()).describe('All accounts, with their current balances'),
}).loose();

const tool: ToolDefinitionWithOutput = {
  name: 'actual_accounts_list',
  description: "List all accounts in Actual Budget including checking, savings, credit cards, and investment accounts. Returns account ID, name, balance (in cents), on-budget/off-budget status, and open/closed state.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  call: async (_args: unknown, _meta?: unknown) => {
    // Single API session: getAccounts + all balances in one withActualApi cycle.
    // Calling getAccountBalance() per-account would open N separate sessions and
    // overwhelm the Actual server with concurrent init/shutdown cycles.
    const result = await adapter.getAccountsWithBalances();
    return { result };
  },
};

export default tool;
