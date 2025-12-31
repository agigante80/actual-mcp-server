import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Payee[]
type Output = unknown; // refine using generated types (paths['/payees']['get'])

const tool: ToolDefinition = {
  name: 'actual_payees_get',
  description: "List all payees in Actual Budget. Payees represent merchants, service providers, individuals, or other entities you transact with. Returns payee ID, name, and optional transfer account information for internal transfers.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    InputSchema.parse(args || {});
    const result = await adapter.getPayees();
    return { result };
  },
};

export default tool;
