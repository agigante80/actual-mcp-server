import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({ "accountId": z.string().optional(), "startDate": z.string().optional(), "endDate": z.string().optional() });

// RESPONSE_TYPE: Transaction[]
type Output = any; // refine using generated types (paths['/transactions']['get'])

const tool: ToolDefinition = {
  name: 'actual.transactions.get',
  description: "Get transactions for an account and date range",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    InputSchema.parse(args || {});
    // TODO: implement call to Actual API using generated client/adapters
    return { result: null };

  },
};

export default tool;
