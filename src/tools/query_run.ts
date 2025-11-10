import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  query: z.string().min(1).describe('ActualQL query string to execute'),
});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_query_run',
  description: 'Execute a custom ActualQL query for advanced data analysis. ActualQL is Actual Budget\'s query language that allows filtering and aggregating financial data. Use this for complex queries beyond the standard tool capabilities.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.runQuery(input.query);
    return { result };
  },
};

export default tool;
