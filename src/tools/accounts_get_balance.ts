import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ id: z.string().optional(), cutoff: z.string().optional() });

// RESPONSE_TYPE: number
type Output = unknown; // refine using generated types (paths['/accounts/balance']['get'])

const tool: ToolDefinition = {
  name: 'actual_accounts_get_balance',
  description: "Get account balance",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.getAccountBalance(input.id ?? '', input.cutoff);
    return { result };
  },
};

export default tool;
