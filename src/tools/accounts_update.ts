import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ id: z.string().min(1), fields: z.record(z.unknown()).optional() });

// RESPONSE_TYPE: any
type Output = any; // refine using generated types (paths['/accounts']['put'])

const tool: ToolDefinition = {
  name: 'actual.accounts.update',
  description: "Update an account",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    const input = InputSchema.parse(args || {});
    await adapter.updateAccount(input.id, input.fields ?? {} as any);
    return { result: true };
  },
};

export default tool;
