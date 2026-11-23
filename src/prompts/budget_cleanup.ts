import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { completeDay } from './completions.js';
import { dayArgSchema, monthStart } from './dates.js';
import { EMPTY_RESULT_LINE, origin } from './shared.js';

/**
 * budget_cleanup (#664): a read-only structure review that proposes changes and asks before any
 * write. The date default lives in the SCHEMA (#660 item 5). The window start is the first day of
 * the month six months before the date's month, by integer month arithmetic.
 */

// This prompt stays offered under MCP_READ_ONLY on purpose (its required tools are all reads, and an
// analysis is useful read-only), so its text names no write tool: each proposal names the change in
// words, and the ask to apply is conditional on having tools for it. Adding the manage_ tools to
// requiredTools would hide it exactly where it is safest; that was weighed and rejected (#805).
const TEMPLATE = `Review the structure of my budget as of {date} and propose a cleanup.{origin} This is analysis only: do not create, change, merge or delete anything. A payee, category or account counts as unused only when it has no transaction and no transfer from {start_date} to {date}.

Before step 1, call list_budget_months with no month to get the months the budget covers. If {month} is not in that list, the budget has no data for it: do not call list_budget_months with {month}, say that the budget does not cover {month}, and say that the window from {start_date} to {date} is not fully inside the months the budget covers, so the summaries in step 1 cannot prove that something is unused. Then report duplicates only (the same-name payees in step 2, overlapping rules in step 3, near-duplicate category names in step 4) and mark nothing as unused, stale or closable: skip step 5 and the budget check in step 4.

1. Call summarize_transactions three times with report grouped, start_date {start_date}, end_date {date}, include_income true and exclude_transfers false: once with group_by payee, once with group_by category, once with group_by account. Each group has its id and name (payeeId and payeeName, categoryId and categoryName, or accountId and accountName, by group_by) and a transactionCount. Every group also has a transferCount, the number of transfers counted under it (for a category, a transfer to or from an off-budget account that carries the category); transactionCount does not include transfers, so a group with transactionCount 0 and a transferCount above 0 is in use. Anything missing from a result had no transaction and no transfer in the window.
2. Call list_entities with type payee. Find likely duplicates (the same name apart from case, spacing or a store number) and unused payees. Skip payees with a transfer_acct: those are the transfer payees of accounts.
3. Call list_entities with type rule. Conditions and actions hold ids, not names. Find rules with identical or overlapping conditions, rules that refer to a payee or category id that is not in the lists from steps 2 and 4, and rules whose payee is unused.
4. Call list_entities with type category_group, then list_budget_months with month {month}. Find unused categories that also have budgeted 0 and balance 0 in {month}, groups with no categories, and near-duplicate category names. Never propose deleting a category that still holds a balance. If {month} is not a budget month (see the paragraph before step 1), skip the budget check, say so, and do not propose deleting any category, because its balance cannot be checked.
5. Call list_entities with type account. Find open accounts (closed false) with balance_current 0 that are unused: no group for the account in the step 1 account result, or both transactionCount and transferCount 0. An account with a transferCount above 0 is in use, so do not propose closing it. A null balance_current is unknown, so skip that account.
6. Present the findings grouped by payees, rules, categories and accounts. For each give the evidence (the window, transaction counts, balances) and the change you would make, naming the change it needs: merge or delete a payee, update or delete a rule, delete a category or an empty category group, or close an account.
7. If you have tools that can make these changes, end by asking which items I want applied; otherwise end after the findings. Do not call any manage_ tool in this turn.

${EMPTY_RESULT_LINE}

Amounts are integer cents; divide by 100 and show currency.`;

const budget_cleanup: PromptDefinition = {
  name: 'budget_cleanup',
  title: 'Budget cleanup',
  description:
    'Read-only review of payees, rules, categories and accounts for duplicates and unused items; proposes changes and asks before writing.',
  arguments: [
    {
      name: 'date',
      title: 'As-of date',
      description: "Day to review as of, YYYY-MM-DD. Defaults to the server's today.",
      required: false,
      complete: completeDay,
    },
  ],
  requiredTools: ['list_entities', 'summarize_transactions', 'list_budget_months'],
  argsSchema: z.strictObject({ date: dayArgSchema() }),
  render(args, ctx) {
    const date = args.date as string;
    const month = date.slice(0, 7);
    return TEMPLATE.replace('{origin}', ctx.defaulted.has('date') ? origin.date(date) : '')
      .replaceAll('{date}', date)
      .replaceAll('{month}', month)
      .replaceAll('{start_date}', monthStart(month, 7));
  },
};

export default budget_cleanup;
