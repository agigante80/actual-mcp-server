import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  budgetName: z.string().min(1, 'budgetName must not be empty').describe(
    'The name of the budget to switch to, as configured via BUDGET_n_NAME environment variables. ' +
    'Use actual_budgets_list_available to see all available budget names. ' +
    'Partial / case-insensitive match is supported (e.g. "office" matches "Office Budget").'
  ),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_switch',
  description:
    'Switch to a different pre-configured budget for all subsequent operations. ' +
    'Each budget can target a different Actual Budget server, sync ID, and encryption password. ' +
    'Call actual_budgets_list_available first to see the available budget names. ' +
    'The switch is instant and takes effect immediately — no server restart required.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const { budgetName } = InputSchema.parse(args);
    const result = await Promise.resolve(adapter.switchBudget(budgetName));
    return {
      success: true,
      budgetName: result.name,
      budgetId: result.syncId,
      serverUrl: result.serverUrl,
      message: `Switched to budget '${result.name}' (${result.syncId}) on ${result.serverUrl}. All subsequent operations now target this budget.`,
    };
  },
};

export default tool;

