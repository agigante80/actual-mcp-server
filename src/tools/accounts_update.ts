import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.any();

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
