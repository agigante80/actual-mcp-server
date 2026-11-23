import { showDiscoveredBudgets } from '../lib/budgetSelector.js';
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_budgets_list_available',
  description:
    (showDiscoveredBudgets ? 'List configured and shared budgets visible to this session. ' :
      'List pre-configured budgets visible to this session (BUDGET_n_NAME / BUDGET_n_SYNC_ID / BUDGET_n_SERVER_URL). ') +
    'Rows show name, Sync ID, server origin and E2E encryption. ' +
    (showDiscoveredBudgets ? 'Locked rows are encrypted, lack a server key and cannot be switched to. ' : '') +
    'The row with active true is this session\'s budget. ' +
    'Pass a budget name to actual_budgets_switch.',
  inputSchema: InputSchema,
  call: async (_args: unknown) => {
    const budgets = await Promise.resolve(adapter.getBudgetRegistry());
    return {
      budgets,
      count: budgets.length,
      hint: showDiscoveredBudgets
        ? 'Pass the exact name or Sync ID of the desired budget to actual_budgets_switch.'
        : 'Pass the exact name (case-insensitive) of the desired budget to actual_budgets_switch.',
    };
  },
};

export default tool;

