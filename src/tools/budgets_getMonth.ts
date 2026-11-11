import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// month stays optional in the schema (#639 adds a description only), but it must be supplied:
// upstream calls month.match() on it, so an omitted month fails.
const InputSchema = z.object({
  month: z.string().optional()
    .describe('Month as YYYY-MM, one the budget has (see actual_budgets_getMonths). Required in practice: always supply it'),
});

// RESPONSE_TYPE: BudgetMonth

const tool: ToolDefinition = {
  name: 'actual_budgets_getMonth',
  description: "Get budget data for a specific month in YYYY-MM format (e.g., '2025-12'). Returns all categories with their budgeted amounts, actual spending, and available balances for the month.",
  inputSchema: InputSchema,
    call: async (args: unknown, _meta?: unknown) => {
      const input = InputSchema.parse(args || {});
      const result = await adapter.getBudgetMonth(input.month);
      return { result };
    },
};

export default tool;
