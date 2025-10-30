import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().min(1).describe('Account ID'),
  name: z.string().optional().describe('Optional new account name'),
  balance: z.number().optional().describe('Optional new balance'),
}).refine(data => !!(data.name !== undefined || data.balance !== undefined), {
  message: 'At least one updatable field (name or balance) must be provided',
});

// RESPONSE_TYPE: any
type Output = any; // refine using generated types (paths['/accounts']['put'])

const tool: ToolDefinition = {
  name: 'actual.accounts.update',
  description: "Update an account",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  // expect { id, ...fields }
  const id = (input as any).id;
  const fields = Object.assign({}, input);
  delete (fields as any).id;
  const res = await adapter.updateAccount(id as any, fields as any);
  return { result: res };

  },
};

export default tool;
