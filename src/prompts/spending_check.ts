import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { completeDay } from './completions.js';
import { dayArgSchema, daysInMonth } from './dates.js';
import { EMPTY_RESULT_LINE, origin } from './shared.js';

/**
 * spending_check (#662): a mid-month pace check as of one day. The default date lives in the
 * SCHEMA (#660 item 5), never in the template. The server renders the day, the days in the month
 * and the first day, so the model does no date arithmetic. The overall budget is the sum of the
 * per-category budgeted values: totalBudgeted is negative in an envelope budget, so it is not used.
 */

const TEMPLATE = `Do a quick spending check for {month}, as of {date}: day {day} of {days_in_month}.{origin} Stay read-only: do not change anything.

Before step 1, call list_budget_months with no month to get the months the budget covers. If {month} is not in that list, the budget has no data for it: do not call list_budget_months with {month}, say that the budget does not cover {month}, and skip step 1. In step 3 report only the spending so far, with no pace verdict, and in the reply say that no pace verdict and no amount left to spend can be given without a budget for {month}.

1. Call list_budget_months with month {month}. Per expense category it gives budgeted, spent and balance. spent is negative cents for outflows and counts every transaction dated in {month}, including any dated after {date}. balance includes any carryover; a category is over budget when its balance is below zero. The month total totalBalance is the sum of the expense category balances, so an overspent category reduces it. Ignore income categories, which carry received instead of spent.
2. Call summarize_transactions with report by_category, start_date {first_day} and end_date {date}. Its totalAmount per categoryName is the spending up to {date}, negative cents for outflows. Rows named Uncategorized can hold transfers: report their total separately and leave them out of the pace check.
3. Check the pace with the step 2 amounts and the step 1 budgets, matched by category name. The share of the month gone is {day} of {days_in_month}. Overall spending so far is the sum of the step 2 rows other than Uncategorized, as a positive amount; overall budget is the sum of budgeted over the expense categories from step 1. Overall I am on track when that spending is at most the overall budget times that share. A category is on pace to run over when its spending so far, as a positive amount, is above its budgeted times that share while its balance is still zero or more. Skip categories with budgeted 0. On day 1 skip the pace check and report only categories already over budget, unless step 1 was skipped: with no budget for {month} there is nothing to compare against, so report the spending so far only.
4. Reply briefly:
   - Am I on track overall, yes or no, and by how much?
   - Which categories are already over budget, and which are on pace to be?
   - How much can I still spend in {month} in total: totalBalance from step 1. A positive number is money left, and spending dated after {date} is already taken out of it.

${EMPTY_RESULT_LINE}

Just the key numbers and warnings. Amounts come back as integer cents; divide by 100 and show them as currency.`;

const spending_check: PromptDefinition = {
  name: 'spending_check',
  title: 'Spending check',
  description:
    'Quick check on a month so far: on track or overspending, categories to watch, and what is left to spend.',
  arguments: [
    {
      name: 'date',
      title: 'As-of date',
      description: "Day to check as of, YYYY-MM-DD. Defaults to the server's today.",
      required: false,
      complete: completeDay,
    },
  ],
  requiredTools: ['list_budget_months', 'summarize_transactions'],
  argsSchema: z.strictObject({ date: dayArgSchema() }),
  render(args, ctx) {
    const date = args.date as string;
    const month = date.slice(0, 7);
    return TEMPLATE.replace('{origin}', ctx.defaulted.has('date') ? origin.date(date) : '')
      .replaceAll('{date}', date)
      .replaceAll('{month}', month)
      .replaceAll('{first_day}', `${month}-01`)
      .replaceAll('{day}', String(Number(date.slice(8, 10))))
      .replaceAll('{days_in_month}', String(daysInMonth(month)));
  },
};

export default spending_check;
