import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).describe('Account display name'),
  balance: z.number().optional(),
});

// RESPONSE_TYPE: string
type Output = any; // refine using generated types (paths['/accounts']['post'])

const tool: ToolDefinition = {
  name: 'actual.accounts.create',
  description: "Create an account",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args ?? {});
    // adapter.createAccount may accept an optional initial balance param
    const payload = input as { id?: string; name: string; balance?: number };
    const res = await adapter.createAccount(payload as unknown, payload.balance);
  return { result: res };

  },
};

export default tool;
