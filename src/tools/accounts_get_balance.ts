import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ "id": z.string().optional(), "cutoff": z.string().optional() });

// RESPONSE_TYPE: number
type Output = number;

const tool: ToolDefinition = {
  name: 'actual.accounts.get.balance',
  description: "Get account balance",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const { id, cutoff } = input as { id?: string; cutoff?: string };
  const res = await adapter.getAccountBalance(id, cutoff);
  return { result: res };

  },
};

export default tool;
