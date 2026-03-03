import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_budgets_list_available',
  description:
    'List all pre-configured budgets available for switching. ' +
    'Each entry shows the budget name, sync ID, server URL, and whether it uses E2E encryption. ' +
    'Budgets are configured via BUDGET_n_NAME / BUDGET_n_SYNC_ID / BUDGET_n_SERVER_URL env vars. ' +
    'Pass the budget name to actual_budgets_switch to change the active budget.',
  inputSchema: InputSchema,
  call: async (_args: unknown) => {
    const budgets = await Promise.resolve(adapter.getBudgetRegistry());
    return {
      budgets,
      count: budgets.length,
      hint: 'Pass the name (or partial name) of the desired budget to actual_budgets_switch.',
    };
  },
};

export default tool;

