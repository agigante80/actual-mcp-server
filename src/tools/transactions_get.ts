import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ accountId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() });

// RESPONSE_TYPE: Transaction[]
type Output = unknown; // refine using generated types (paths['/transactions']['get'])

const tool: ToolDefinition = {
  name: 'actual_transactions_get',
  description: "Get all transactions for a specific account within a date range. Returns transaction details including date, amount (cents), payee, category, notes, and cleared status. Dates in YYYY-MM-DD format. Perfect for account reconciliation and spending analysis.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
    return { result };
  },
};

export default tool;
