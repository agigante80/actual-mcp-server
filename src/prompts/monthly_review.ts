import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { completeMonth } from './completions.js';
import { currentMonth, daysInMonth, monthArgSchema } from './dates.js';
import { EMPTY_RESULT_LINE, ZERO_INCOME_LINE, origin } from './shared.js';

/**
 * monthly_review (#661): budget versus actual for one month. A static numbered script that names
 * compact tools; the model does the analysis. The month default lives in the SCHEMA (#660 item 5),
 * never in the template, so the rendered text always carries a concrete month.
 */

/** The last day of a YYYY-MM month, zero padded: 2024-02 gives 29, 2026-12 gives 31. */
function lastDayOfMonth(month: string): string {
  return String(daysInMonth(month)).padStart(2, '0');
}

const TEMPLATE = `Review my budget for {month}, from {first_day} to {last_day}.{origin} Work through these steps and stay read-only: do not change anything.

Before step 1, call list_budget_months with no month to get the months the budget covers. If {month} is not in that list, the budget has no data for it: do not call list_budget_months with {month}, say that the budget does not cover {month}, and skip step 2 and the searches in step 4. Answer from step 3 alone: income, expenses and the savings rate, with no budgeted, overspent or unused-budget figures.

1. Call get_context with include_payees false to see the accounts, category groups and categories.
2. Call list_budget_months with month {month}. Per expense category it gives budgeted, spent and balance; spent is negative cents for outflows, and balance includes any carryover. A category is overspent when its balance is below zero. The month totals give income, budgeted and spent.
3. Call summarize_transactions with report by_category, start_date {first_day}, end_date {last_day} and include_income true, to see where the money actually went; the category group tells income from expenses. Compare it with step 2.
4. For each overspent category, call search_transactions with by category, category_name exactly as list_budget_months spells it, start_date {first_day}, end_date {last_day} and limit 1000. Rows come newest first with no amount sort, so pick the three largest outflows yourself. count is the number of rows returned: if it equals 1000 the list may be cut off, so say the three largest are the largest of the rows returned.
5. Answer with:
   - one paragraph on how the month went
   - the categories that went over budget and by how much
   - the categories with budget left unused
   - income, expenses and the savings rate (income minus expenses, divided by income). Rows named Uncategorized have no category group and can hold transfers: leave them out of income and expenses for the savings rate and report their total on its own line. ${ZERO_INCOME_LINE}
   - two or three concrete changes to try next month

${EMPTY_RESULT_LINE}

Quote amounts as currency (the tools return integer cents; divide by 100). Keep it short and numeric.`;

const monthly_review: PromptDefinition = {
  name: 'monthly_review',
  title: 'Monthly budget review',
  description:
    'Review a month: budget versus actual per category, overspent and unused categories, income versus expenses, and suggestions.',
  arguments: [
    {
      name: 'month',
      title: 'Month',
      description: "Month to review, YYYY-MM. Defaults to the server's current month.",
      required: false,
      complete: completeMonth,
    },
  ],
  requiredTools: ['get_context', 'list_budget_months', 'summarize_transactions', 'search_transactions'],
  argsSchema: z.strictObject({
    month: monthArgSchema().default(() => currentMonth()),
  }),
  render(args, ctx) {
    const month = args.month as string;
    const note = ctx.defaulted.has('month') ? origin.month(month) + origin.unfinished : '';
    return TEMPLATE.replace('{origin}', note)
      .replaceAll('{month}', month)
      .replaceAll('{first_day}', `${month}-01`)
      .replaceAll('{last_day}', `${month}-${lastDayOfMonth(month)}`);
  },
};

export default monthly_review;
