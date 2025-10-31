import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ accountId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() });

// RESPONSE_TYPE: Transaction[]
type Output = any; // refine using generated types (paths['/transactions']['get'])

const tool: ToolDefinition = {
  name: 'actual.transactions.get',
  description: "Get transactions for an account and date range",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.getTransactions(input.accountId, input.startDate, input.endDate);
    return { result };
  },
};

export default tool;
