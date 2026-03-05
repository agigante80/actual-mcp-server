import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Account[]
type Output = unknown; // refine using generated types (paths['/accounts']['get'])

const tool: ToolDefinition = {
  name: 'actual_accounts_list',
  description: "List all accounts in Actual Budget including checking, savings, credit cards, and investment accounts. Returns account ID, name, balance (in cents), on-budget/off-budget status, and open/closed state.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Single API session: getAccounts + all balances in one withActualApi cycle.
    // Calling getAccountBalance() per-account would open N separate sessions and
    // overwhelm the Actual server with concurrent init/shutdown cycles.
    const result = await adapter.getAccountsWithBalances();
    return { result };
  },
};

export default tool;
