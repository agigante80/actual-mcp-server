import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
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
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args ?? {});
    const payee = input as { name: string; notes?: string };
    const res = await adapter.createPayee(payee);
  return { result: res };

  },
};

export default tool;
