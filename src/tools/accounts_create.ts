import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).describe('Account display name'),
  balance: z.number().optional(),
});

// RESPONSE_TYPE: string
type Output = string;

const tool: ToolDefinition = {
  name: 'actual.accounts.create',
  description: "Create an account",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const { id, name, balance } = input as { id?: string; name: string; balance?: number };
  // adapter.createAccount may accept an optional initial balance param
  const res = await adapter.createAccount({ id, name }, balance);
  return { result: res };

  },
};

export default tool;
