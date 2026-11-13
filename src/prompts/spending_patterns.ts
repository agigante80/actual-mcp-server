import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { daysInMonth, monthStart, previousMonth } from './dates.js';

/**
 * spending_patterns (#663): a trend analysis over the last N full months. Both defaults live in
 * the SCHEMA (#660 item 5). MCP sends arguments as strings, so months is a string that the schema
 * transforms to a number. The server renders the concrete range with integer month arithmetic.
 */

const TEMPLATE = `Analyse my spending patterns over the last {months} full months, from {start_date} to {end_date}. Stay read-only: do not change anything.

1. Call summarize_transactions with report grouped, start_date {start_date}, end_date {end_date}, group_by month and include_income true. Each group is one month with income, expenseOutflow, credits and netExpense (expenseOutflow minus credits). The savings rate for a month is income minus netExpense, divided by income.
2. Call summarize_transactions with report grouped, start_date {start_date}, end_date {end_date} and group_by ["category", "month"]. Each group is one category in one month with its netExpense. Compare each category across the months to find the ones rising and falling; a category with no group in a month spent nothing that month.
3. Call list_budget_months with month {end_month} to compare the trend with what was budgeted for the last month of the range: per expense category it gives budgeted, spent and balance.
4. Report:
   - the overall direction of spending (up, down, flat) with percentages
   - the three categories that changed the most, with before and after amounts
   - the savings rate trend month by month
   - anything unusual: a single large month, or a category that appeared or went to zero
   - two or three concrete suggestions

Be specific with numbers and percentages. The tools return integer cents; divide by 100 and show currency.`;

const spending_patterns: PromptDefinition = {
  name: 'spending_patterns',
  title: 'Spending patterns',
  description:
    'Spending trends over the last N full months: direction, biggest category changes, savings rate trend, unusual items.',
  arguments: [
    {
      name: 'months',
      description: 'Number of full months to analyse, 1 to 24. Defaults to 6.',
      required: false,
    },
    {
      name: 'end_month',
      description: "Last full month to include, YYYY-MM. Defaults to the month before the server's current month.",
      required: false,
    },
  ],
  requiredTools: ['summarize_transactions', 'list_budget_months'],
  argsSchema: z.strictObject({
    months: z
      .string()
      .max(2)
      .regex(/^(?:[1-9]|1\d|2[0-4])$/)
      .transform(Number)
      .default(6),
    end_month: z
      .string()
      .max(7)
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .default(() => previousMonth()),
  }),
  render(args) {
    const months = args.months as number;
    const endMonth = args.end_month as string;
    const endDate = `${endMonth}-${String(daysInMonth(endMonth)).padStart(2, '0')}`;
    return TEMPLATE.replaceAll('{months}', String(months))
      .replaceAll('{end_month}', endMonth)
      .replaceAll('{start_date}', monthStart(endMonth, months))
      .replaceAll('{end_date}', endDate);
  },
};

export default spending_patterns;
