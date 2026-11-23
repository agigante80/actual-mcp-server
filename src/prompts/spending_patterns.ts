import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { completeEndMonth, completeMonthCount } from './completions.js';
import { daysInMonth, monthArgSchema, monthStart, previousMonth } from './dates.js';
import { EMPTY_RESULT_LINE, ZERO_INCOME_LINE, origin } from './shared.js';

/**
 * spending_patterns (#663): a trend analysis over the last N full months. Both defaults live in
 * the SCHEMA (#660 item 5). MCP sends arguments as strings, so months is a string that the schema
 * transforms to a number. The server renders the concrete range with integer month arithmetic.
 */

const ONE_MONTH_LINE =
  'The period is a single month, so skip the comparison across months and the ranking of the categories that changed the most, and say so.';

/** One static message for every way `months` can be wrong (#772). */
const MONTHS_MESSAGE = 'must be a whole number from 1 to 24';

const TEMPLATE = `Analyse my spending patterns over the last {months} full {unit}, from {start_date} to {end_date}.{origin} Stay read-only: do not change anything.

Before step 1, call list_budget_months with no month to get the months the budget covers. If {end_month} is not in that list, the budget has no data for it: do not call list_budget_months with {end_month}, say that the budget does not cover {end_month}, and skip step 3. Steps 1 and 2 still run.

1. Call summarize_transactions with report grouped, start_date {start_date}, end_date {end_date}, group_by month and include_income true. Each group is one month with income, expenseOutflow, credits and netExpense (expenseOutflow minus credits). The savings rate for a month is income minus netExpense, divided by income. ${ZERO_INCOME_LINE}
2. Call summarize_transactions with report grouped, start_date {start_date}, end_date {end_date} and group_by ["category", "month"]. Each group is one category in one month with its netExpense. Compare each category across the months to find the ones rising and falling; a category with no group in a month spent nothing that month.
3. Call list_budget_months with month {end_month} to compare the trend with what was budgeted for the last month of the range: per expense category it gives budgeted, spent and balance.
4. Report:
   - the overall direction of spending (up, down, flat) with percentages
   - the three categories that changed the most, with before and after amounts
   - the savings rate trend month by month
   - anything unusual: a single large month, or a category that appeared or went to zero
   - two or three concrete suggestions

{one_month}${EMPTY_RESULT_LINE}

Be specific with numbers and percentages. The tools return integer cents; divide by 100 and show currency.`;

const spending_patterns: PromptDefinition = {
  name: 'spending_patterns',
  title: 'Spending patterns',
  description:
    'Spending trends over the last N full months: direction, biggest category changes, savings rate trend, unusual items.',
  // #773: Claude Code maps positional tokens to arguments by this declared order (measured on
  // 2.1.330 with a stub server, recorded on the ticket), so the order is a contract: a lone
  // `2026-09` must land in end_month. Other clients were not checked. Do not swap back without a reason.
  arguments: [
    {
      name: 'end_month',
      title: 'Last month',
      description:
        "Last full month to include, YYYY-MM. Defaults to the month before the server's current month. Give it first when passing arguments by position.",
      required: false,
      complete: completeEndMonth,
    },
    {
      name: 'months',
      title: 'Number of months',
      description: 'Number of full months to analyse, 1 to 24. Defaults to 6. Positional order: end_month, then months.',
      required: false,
      complete: completeMonthCount,
    },
  ],
  requiredTools: ['summarize_transactions', 'list_budget_months'],
  argsSchema: z.strictObject({
    months: z
      .string()
      .max(2, { error: MONTHS_MESSAGE, abort: true })
      .regex(/^(?:[1-9]|1\d|2[0-4])$/, MONTHS_MESSAGE)
      .transform(Number)
      .default(6),
    end_month: monthArgSchema().default(() => previousMonth()),
  }),
  render(args, ctx) {
    const months = args.months as number;
    const endMonth = args.end_month as string;
    const endDate = `${endMonth}-${String(daysInMonth(endMonth)).padStart(2, '0')}`;
    const note = ctx.defaulted.has('end_month') ? origin.endMonth(endMonth) : '';
    return TEMPLATE.replace('{origin}', note)
      .replace('{one_month}', months === 1 ? `${ONE_MONTH_LINE} ` : '')
      .replaceAll('{months}', String(months))
      .replaceAll('{unit}', months === 1 ? 'month' : 'months')
      .replaceAll('{end_month}', endMonth)
      .replaceAll('{start_date}', monthStart(endMonth, months))
      .replaceAll('{end_date}', endDate);
  },
};

export default spending_patterns;
