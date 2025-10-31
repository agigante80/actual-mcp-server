import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ name: z.string().min(1), notes: z.string().optional() });

// RESPONSE_TYPE: string
type Output = unknown; // refine using generated types (paths['/payees']['post'])

const tool: ToolDefinition = {
  name: 'actual.payees.create',
  description: "Create payee",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // call adapter to create payee
    const result = await adapter.createPayee(input);
    return { result };
  },
};

export default tool;
