import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { FULL_SURFACE, type CompactToolSpec, type DescriptionContext } from '../types.js';

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

/** The published text names only the sibling tools this server carries (#770); the full surface is the default text. */
function describe(ctx: DescriptionContext): string {
  const pointers = [
    ctx.hasTool('summarize_transactions') && 'for actual spending totals use summarize_transactions',
    ctx.hasTool('list_entities') && 'for ids use list_entities',
    ctx.hasTool('search_transactions') && 'for individual transactions use search_transactions',
  ].filter((x): x is string => typeof x === 'string');
  return (
    'List the budget months, or read one month\'s budget when `month` is given. Use it for budgeted versus spent per category' +
    (pointers.length > 0 ? `; ${pointers.join(', ')}` : '') +
    '.' +
    (ctx.hasTool('manage_budget_months') ? ' To change a budgeted amount use manage_budget_months.' : '') +
    '\n' +
    'month: optional, YYYY-MM; the only input, any other property is refused by name.\n' +
    'Returns { result: [YYYY-MM, ...] }, the budget months and nothing else, when `month` is omitted.\n' +
    'Fields: totalSpent sums expense transactions (negative for spending); totalBalance sums the category balances. On an envelope budget totalBudgeted is the expense budgets summed with the sign reversed (negative when money is budgeted), toBudget is what is left to budget and forNextMonth the amount held; on a tracking budget totalBudgeted is a plain positive sum and the other two are absent.\n' +
    'Returns { result } holding that month\'s budget when `month` is given: totals (totalIncome, totalBudgeted, totalSpent, toBudget, forNextMonth, totalBalance) and categoryGroups; an expense category carries budgeted, spent and balance, an income category received; amounts are integer cents.'
  );
}

export const listBudgetMonths: CompactToolSpec = {
  name: 'list_budget_months',
  domain: 'Budget months',
  summary: 'Read the list of budget months, or one month with budgeted, spent and balance per category.',
  examplePrompt: 'Which categories are overspent in October 2026?',
  description: describe(FULL_SURFACE),
  describeFor: describe,
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
