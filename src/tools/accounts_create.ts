import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.any();

// RESPONSE_TYPE: string
type Output = any; // refine using generated types (paths['/accounts']['post'])

const tool: ToolDefinition = {
  name: 'actual.accounts.create',
  description: "Create an account",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const res = await adapter.createAccount(input as any, (input as any).initialBalance as any);
  return { result: res };

  },
};

export default tool;
