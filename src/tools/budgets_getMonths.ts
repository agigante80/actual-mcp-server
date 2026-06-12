import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

// RESPONSE_TYPE: array

const tool: ToolDefinition = {
  name: 'actual_budgets_getMonths',
  description: "Get a list of all available budget months with summary data. Returns an array of months showing total budgeted, spent, and income for each month. Useful for viewing budget history and trends over time.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    InputSchema.parse(args || {});
    const result = await adapter.getBudgetMonths();
    return { result };
  },
};

export default tool;
