import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { completeDay } from './completions.js';
import { dayArgSchema, daysInMonth, monthStart } from './dates.js';
import { EMPTY_RESULT_LINE, origin } from './shared.js';

/**
 * subscription_finder (#776): find recurring charges from 12 whole months of payee history and
 * compare them with the schedules. Same design as budget_cleanup (#805): one text for every
 * surface, the read tools required, and the write step phrased in words and conditional on the model
 * HAVING a tool that can create a schedule, so the text names no manage_ tool and stays valid under
 * MCP_READ_ONLY. The 3 month minimum and the 10 percent band are fixed in the text so the result is
 * reproducible; change them only with a recorded reason. The `recurring` report of
 * summarize_transactions was weighed and not used: it has no per-month series to state "seen in N
 * months" or to ignore an outlier month.
 */
const TEMPLATE = `Find my recurring charges as of {date}, using the 12 whole months from {start_date} to {end_date}.{origin} This is analysis first: do not create, change or delete anything until I say yes to a specific item.

1. Call summarize_transactions with report grouped, start_date {start_date}, end_date {end_date}, group_by ["payee", "month"], include_income false and exclude_transfers true. Each group is one payee in one month with its payeeId, payeeName, month and netExpense (net spending in cents, outflow minus credits, so a charge is a positive number).
2. The result has one group per payee per month and can be large: ignore every payee that appears in only one month, without listing it. A candidate is a payee with a charge in at least 3 different months whose amounts are close: take the median monthly netExpense as the typical amount and count only the months within 10 percent of it. State the confidence as the number of months seen out of 12. Derive the cadence from the gaps between the months seen: a typical gap of 1 month, or 6 or more months seen, is monthly; a typical gap of 3 months is quarterly; anything else with 3 or more sightings is irregular and goes to the weak group. Two sightings are a weak signal: list them in a separate "weak" group, never in the main table. The last month in the window may not be over, so a charge that has not appeared yet in it is not a sign that it stopped. Yearly charges show once in 12 months and are not found here: say so in one line.
3. Call list_entities with type schedule. Mark each candidate as scheduled or not: match the schedule's payee id with the candidate's payeeId first, then the schedule name with the payee name.
4. Present a table sorted by estimated annual cost, largest first: payee, typical amount, cadence, months seen of 12, scheduled yes or no. The annual cost is the typical amount times 12 for monthly and times 4 for quarterly. Give the total monthly cost of the candidates as the annual total divided by 12.
5. If you have a tool that can create a schedule, end by offering to schedule the unscheduled candidates ONE at a time: name the schedule, the payee, the typical amount as negative cents and the recurrence of its cadence (monthly, or monthly with interval 3 for quarterly) starting at the next expected date, and create it only after I answer yes for that item. Never create anything from the table without a yes for that item. If you have no such tool, end after the table.

${EMPTY_RESULT_LINE}

Amounts are integer cents; divide by 100 and show currency.`;

const subscription_finder: PromptDefinition = {
  name: 'subscription_finder',
  title: 'Subscription finder',
  description:
    'Find recurring charges from 12 months of payee history, compare them with your schedules, and offer a schedule for an unscheduled one only after you say yes.',
  arguments: [
    {
      name: 'date',
      title: 'As-of date',
      description:
        "Day to review as of, YYYY-MM-DD. The 12 whole months ending with its month are analysed. Defaults to the server's today.",
      required: false,
      complete: completeDay,
    },
  ],
  requiredTools: ['summarize_transactions', 'list_entities'],
  argsSchema: z.strictObject({ date: dayArgSchema() }),
  render(args, ctx) {
    const date = args.date as string;
    const month = date.slice(0, 7);
    const endDate = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    return TEMPLATE.replace('{origin}', ctx.defaulted.has('date') ? origin.date(date) : '')
      .replaceAll('{date}', date)
      .replaceAll('{start_date}', monthStart(month, 12))
      .replaceAll('{end_date}', endDate);
  },
};

export default subscription_finder;
