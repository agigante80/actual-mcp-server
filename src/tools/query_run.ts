import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  query: z.string().min(1).describe('ActualQL query string to execute'),
});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_query_run',
  description: 'Execute a custom ActualQL query for advanced data analysis. Supports simple SQL-like syntax: "SELECT * FROM tablename LIMIT n" or just a table name like "accounts". Available tables: accounts, transactions, categories, payees, category_groups, schedules, rules.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const result = await adapter.runQuery(input.query);
    return { result };
  },
};

export default tool;
