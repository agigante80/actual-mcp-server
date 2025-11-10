import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_budgets_get_all',
  description: 'Get a list of all available budget files. Useful for multi-budget management and discovering available budgets on the server.',
  inputSchema: InputSchema,
  call: async (_args: unknown, _meta?: unknown) => {
    const result = await adapter.getBudgets();
    return { result };
  },
};

export default tool;
