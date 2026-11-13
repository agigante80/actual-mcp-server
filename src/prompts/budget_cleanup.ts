import { z } from 'zod';
import type { PromptDefinition } from './registry.js';
import { dayArgSchema, monthStart } from './dates.js';

/**
 * budget_cleanup (#664): a read-only structure review that proposes changes and asks before any
 * write. The date default lives in the SCHEMA (#660 item 5). The window start is the first day of
 * the month six months before the date's month, by integer month arithmetic.
 */

const TEMPLATE = `Review the structure of my budget as of {date} and propose a cleanup. This is analysis only: do not create, change, merge or delete anything. A thing counts as unused when it has no transaction from {start_date} to {date}.

1. Call summarize_transactions three times with report grouped, start_date {start_date}, end_date {date}, include_income true and exclude_transfers false: once with group_by payee, once with group_by category, once with group_by account. Each group has an id, a name and a transactionCount; anything missing from a result had no transaction in the window.
2. Call list_entities with type payee. Find likely duplicates (the same name apart from case, spacing or a store number) and unused payees. Skip payees with a transfer_acct: those are the transfer payees of accounts.
3. Call list_entities with type rule. Conditions and actions hold ids, not names. Find rules with identical or overlapping conditions, rules that refer to a payee or category id that is not in the lists from steps 2 and 4, and rules whose payee is unused.
4. Call list_entities with type category_group, then list_budget_months with month {month}. Find unused categories that also have budgeted 0 and balance 0 in {month}, groups with no categories, and near-duplicate category names. Never propose deleting a category that still holds a balance. If list_budget_months returns no categories for {month}, skip the budget check and say so rather than treating a category as empty.
5. Call list_entities with type account. Find open accounts (closed false) with balance_current 0 that are unused; a null balance_current is unknown, so skip that account.
6. Present the findings grouped by payees, rules, categories and accounts. For each give the evidence (the window, transaction counts, balances) and the change you would make, naming the action it needs: manage_payees merge or delete, manage_rules update or delete, manage_categories delete, or manage_accounts close.
7. End by asking which items I want applied. Do not call any manage_ tool in this turn.

Amounts are integer cents; divide by 100 and show currency.`;

const budget_cleanup: PromptDefinition = {
  name: 'budget_cleanup',
  title: 'Budget cleanup',
  description:
    'Read-only review of payees, rules, categories and accounts for duplicates and unused items; proposes changes and asks before writing.',
  arguments: [
    {
      name: 'date',
      description: "Day to review as of, YYYY-MM-DD. Defaults to the server's today.",
      required: false,
    },
  ],
  requiredTools: ['list_entities', 'summarize_transactions', 'list_budget_months'],
  argsSchema: z.strictObject({ date: dayArgSchema() }),
  render(args) {
    const date = args.date as string;
    const month = date.slice(0, 7);
    return TEMPLATE.replaceAll('{date}', date)
      .replaceAll('{month}', month)
      .replaceAll('{start_date}', monthStart(month, 7));
  },
};

export default budget_cleanup;
