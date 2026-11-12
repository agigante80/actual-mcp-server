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
  description:
    "Read the budget of one month (YYYY-MM): what was budgeted, spent and left in every category. Read-only; always pass month, the call fails without it. For several months at once use actual_budgets_getMonths; to change an amount use actual_budgets_setAmount or actual_budgets_transfer. Returns { result } with totals (totalIncome, totalBudgeted, totalSpent, toBudget, forNextMonth, totalBalance) and categoryGroups; an expense category carries budgeted, spent and balance, an income category received. Amounts in integer cents.",
  inputSchema: InputSchema,
    call: async (args: unknown, _meta?: unknown) => {
      const input = InputSchema.parse(args || {});
      const result = await adapter.getBudgetMonth(input.month);
      return { result };
    },
};

export default tool;
