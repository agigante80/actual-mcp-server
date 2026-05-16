import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Tightened Zod schema (#156): bounded length and restricted character class.
// Previously z.string().min(1) accepted arbitrarily long inputs with any
// characters, which is exactly the kind of unbounded surface a prompt-injection
// attack would target.
const InputSchema = z.object({
  budgetName: z
    .string()
    .min(1, 'budgetName must not be empty')
    .max(120, 'budgetName must be at most 120 characters')
    .regex(
      /^[\p{L}\p{N} ._\-]+$/u,
      'budgetName must contain only letters, digits, spaces, dots, underscores, and hyphens',
    )
    .describe(
      'The exact name of the budget to switch to, as configured via BUDGET_n_NAME environment variables. ' +
        'Use actual_budgets_list_available to see all available budget names. ' +
        'Matching is case-insensitive but exact (no partial / substring match).',
    ),
});

const tool: ToolDefinition = {
  name: 'actual_budgets_switch',
  description:
    'Switch to a different pre-configured budget for all subsequent operations in this session. ' +
    'Each budget can target a different Actual Budget server, sync ID, and encryption password. ' +
    'Call actual_budgets_list_available first to see the available budget names. ' +
    'The switch is per-session and takes effect immediately; no server restart required.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const { budgetName } = InputSchema.parse(args);
    const result = await adapter.switchBudget(budgetName);
    return {
      success: true,
      budgetName: result.name,
      budgetId: result.syncId,
      serverUrl: result.serverUrl,
      message: `Switched to budget '${result.name}' (${result.syncId}) on ${result.serverUrl}. All subsequent operations in this session now target this budget.`,
    };
  },
};

export default tool;
