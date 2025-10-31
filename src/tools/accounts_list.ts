import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

type Output = any; // refine using generated types (paths['/accounts']['get'])

const tool: ToolDefinition = {
  name: 'actual.accounts.list',
  description: "List all accounts",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    InputSchema.parse(args ?? {});
    const accounts = await adapter.getAccounts();
    return { result: accounts };
  },
};

export default tool;
