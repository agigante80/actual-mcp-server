import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: Account[]
type Output = any; // refine using generated types (paths['/accounts']['get'])

const tool: ToolDefinition = {
  name: 'actual.accounts.list',
  description: "List all accounts",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    // call adapter.getAccounts with no args
    const result = await adapter.getAccounts();
    return { result };

  },
};

export default tool;
