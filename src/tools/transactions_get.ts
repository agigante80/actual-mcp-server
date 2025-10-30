import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ "accountId": z.string().optional(), "startDate": z.string().optional(), "endDate": z.string().optional() });

// RESPONSE_TYPE: Transaction[]
type Output = components['schemas']['Transaction'][];

const tool: ToolDefinition = {
  name: 'actual.transactions.get',
  description: "Get transactions for an account and date range",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const res = await adapter.getTransactions(input.accountId as any, input.startDate as any, input.endDate as any);
  return { result: res };

  },
};

export default tool;
