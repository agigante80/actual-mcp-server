import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ id: z.string().optional(), name: z.string().min(1), balance: z.number().optional() });

// RESPONSE_TYPE: string
type Output = unknown; // refine using generated types (paths['/accounts']['post'])

const tool: ToolDefinition = {
  name: 'actual_accounts_create',
  description: 'Create an account',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // call adapter to create account; adapter returns an id-like string
    const accountPayload = { id: input.id, name: input.name, balance: input.balance };
    const result = await adapter.createAccount(accountPayload, input.balance);
    return { result };
  },
};

export default tool;
