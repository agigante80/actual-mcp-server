import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ 
  id: z.string().min(1, 'Account ID is required').describe('The UUID of the account'),
  cutoff: z.string().optional().describe('Optional cutoff date (YYYY-MM-DD format)')
}).strict();

// RESPONSE_TYPE: number
type Output = unknown; // refine using generated types (paths['/accounts/balance']['get'])

const tool: ToolDefinition = {
  name: 'actual_accounts_get_balance',
  description: `Get the current balance of a specific account.

Required:
- id: Account UUID

Optional:
- cutoff: Date to calculate balance up to (YYYY-MM-DD format)

Returns the account balance as a number (in cents).

Example:
{
  "id": "791f738b-847b-48cc-b32b-bbcf2bc8314f"
}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      const result = await adapter.getAccountBalance(input.id, input.cutoff);
      return { balance: result };
    } catch (error) {
      // Provide helpful error message if account doesn't exist
      const err = error as Error;
      if (err.message?.includes('fetch failed') || err.message?.includes('not found')) {
        throw new Error(`Account not found. Please call actual_accounts_list first to get valid account IDs. Error: ${err.message}`);
      }
      throw error;
    }
  },
};

export default tool;
