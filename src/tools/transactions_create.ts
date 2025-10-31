import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.any();

// RESPONSE_TYPE: Transaction
type Output = any; // refine using generated types (paths['/transactions']['post'])

const tool: ToolDefinition = {
  name: 'actual.transactions.create',
  description: "Create a transaction",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    // validate input
    const input = InputSchema.parse(args || {});
    // call adapter.addTransactions (wrap single transaction into array)
    const result = await adapter.addTransactions([input]);
    return { result };

  },
};

export default tool;
