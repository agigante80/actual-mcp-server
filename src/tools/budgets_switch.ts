import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Tightened Zod schema (#156): bounded length and restricted character class.
// Previously z.string().min(1) accepted arbitrarily long inputs with any
// characters, which is exactly the kind of unbounded surface a prompt-injection
// attack would target.
//
// The character policy is enforced with .refine() rather than .regex() (#293).
// A .regex() with the Unicode-property class below serializes, via
// z.toJSONSchema(), to a JSON Schema `pattern` of "^[\p{L}\p{N} ._\-]+$". That
// pattern depends on the `u` flag, which a JSON Schema `pattern` string cannot
// carry, and OpenAI's Responses function-schema validator rejects `\p{...}`
// escapes outright ("... is not a 'regex'"). Because a client like LibreChat
// forwards every tool in one request, that single rejected schema disabled the
// entire Actual tool surface. A .refine() applies the identical check at parse
// time but emits NO `pattern`, so the published schema stays OpenAI-compatible
// while server-side validation (and Unicode budget-name support) is unchanged.
const BUDGET_NAME_CHARS = /^[\p{L}\p{N} ._\-]+$/u;

const InputSchema = z.object({
  budgetName: z
    .string()
    .min(1, 'budgetName must not be empty')
    .max(120, 'budgetName must be at most 120 characters')
    .refine(
      (value) => BUDGET_NAME_CHARS.test(value),
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
