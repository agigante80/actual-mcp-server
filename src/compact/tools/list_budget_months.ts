import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import type { CompactToolSpec } from '../types.js';

/**
 * list_budget_months (#674): the compact front for the two budget month reads. The tool has
 * NO selector (`selector: null`): the presence of `month` picks the legacy tool. Read-only.
 * Nothing here imports the adapter: the dispatcher reaches Actual only through callOperation.
 *
 * Mapping (#670 section 7): no month -> actual_budgets_get_months (a string[] of YYYY-MM),
 * month -> actual_budgets_get_month. Legacy get_month declares `month` optional but fails
 * without it, so the compact layer never calls it without one.
 *
 * `month` uses CommonSchemas.monthYear (YYYY-MM shape; the range is not checked, upstream
 * answers for a month it does not know).
 */

const month = CommonSchemas.monthYear.describe('Month as YYYY-MM, one the budget has. Omit it to list every month.');

export const listBudgetMonths: CompactToolSpec = {
  name: 'list_budget_months',
  description:
    'List the budget months, or read one month\'s budget when `month` is given. Read-only. ' +
    'Returns the array of budget months as YYYY-MM strings (nothing else) when `month` is omitted. ' +
    'Returns that month\'s budget when `month` (YYYY-MM) is given: totals (totalIncome, totalBudgeted, totalSpent, toBudget, forNextMonth, totalBalance) and categoryGroups; ' +
    'an expense category carries budgeted, spent and balance, an income category received; amounts are integer cents. ' +
    'Use it for budgeted versus spent per category; for actual spending totals use summarize_transactions, for ids use list_entities, ' +
    'for individual transactions use search_transactions. To change a budgeted amount use manage_budget_months. ' +
    'The only input is `month`; any other property is refused by name.',
  selector: null,
  defaultAction: 'list',
  actions: new Map([
    ['list', {
      legacy: 'actual_budgets_get_months',
      fields: z.object({}),
      routes: [{ triggers: ['month'], legacy: 'actual_budgets_get_month', fields: z.object({ month }) }],
    }],
  ]),
};
