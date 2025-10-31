import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  name: z.string().min(1).describe('Payee name'),
  notes: z.string().optional(),
});

// RESPONSE_TYPE: string
type Output = string;

const tool: ToolDefinition = {
  name: 'actual.payees.create',
  description: "Create payee",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const { name, notes } = input as { name: string; notes?: string };
  const res = await adapter.createPayee({ name, notes });
  return { result: res };

  },
};

export default tool;
