import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ "id": z.string().optional(), "cutoff": z.string().optional() });

// RESPONSE_TYPE: number
type Output = any; // refine using generated types (paths['/accounts/balance']['get'])

const tool: ToolDefinition = {
  name: 'actual.accounts.get.balance',
  description: "Get account balance",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const res = await adapter.getAccountBalance((input as any).id as any, (input as any).cutoff as any);
  return { result: res };

  },
};

export default tool;
