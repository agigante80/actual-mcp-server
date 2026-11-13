# Tool overlap inventory (#653)

> **Superseded (#670):** the "keep, sharpen descriptions" conclusion below, and #654's open question, are superseded by the compact tool surface decision in [../explanation/compact-tool-surface.md](../explanation/compact-tool-surface.md). This audit is kept as the point-in-time record.

Why this exists: Glama grades the tool surface for coherence, and Disambiguation scored 2 of 5 for v0.27.1. Our own TDQS run flagged the same overlaps ([tdqs-baseline.md](tdqs-baseline.md)). This doc decides, group by group, whether tools should merge, stay with sharper descriptions, or stay as they are. Which tools a smaller default surface shows is #654's question, not this one's.

This is a point-in-time baseline. Its counts (85 tools) are not kept in step by release tooling. **Do NOT add this file to `FILES` in `scripts/tool-count.mjs`**, or the count check will fail on it at the next tool change.

## Scope and method

Every tool in `IMPLEMENTED_TOOLS` (`src/actualToolsManager.ts`, 85 tools, post-#652 snake_case names) was checked, including the ones that overlap with nothing. The per-domain table below lists all 85 with the group each one belongs to, or "none".

Each decision follows this rubric:

- **Merge**: members return the same entity set under the same annotations and differ only by a parameter.
- **Keep, sharpen descriptions**: members differ in scope, identifier type or output shape. This is the default.
- **Keep as is**: the overlap is only apparent.
- **Reject**: a merge that mixes a tool in `READ_ONLY` (`src/lib/tool-annotations.ts:62`) with one that is not. Reason: "mixes read and write".

Every claim was checked against `src/tools/<name>.ts` (description and schema) and the READ_ONLY set, not against the ticket text.

Alias limit: `DEPRECATED_TOOL_ALIASES` (`src/lib/tool-aliases.ts`) maps an old name to a new name and cannot inject an argument. A merge is alias-only only if every valid input of the removed tool is already valid, with the same meaning, for the survivor. A merge that needs an injected argument (for example a search tool gaining `by: "payee"`) needs its own ticket first, extending the alias value to `{ target, injectedArgs }` and `tests/unit/tool_aliases.test.js`. Merge aliases share the #652 removal policy (first minor release after 2027-02-01) unless a later date is recorded with a reason.

## Result in one paragraph

16 overlap groups were found. None qualifies for a merge: every group differs in scope, identifier type, output shape or failure contract, and no group needs a read and a write tool joined. The outcome is description work: 15 groups are "Keep, sharpen descriptions" and 1 is "Keep as is". The `IMPLEMENTED_TOOLS` count stays at 85.

## Per-domain table of all 85 tools

Group numbers refer to the sections below.

| Domain | Tool | Group |
|--------|------|-------|
| Reports | `actual_account_flow_summary` | 1 |
| Reports | `actual_recurring_expenses_summary` | 1 |
| Accounts | `actual_accounts_close` | 16 |
| Accounts | `actual_accounts_create` | none |
| Accounts | `actual_accounts_delete` | 16 |
| Accounts | `actual_accounts_get_balance` | 11 |
| Accounts | `actual_accounts_list` | 11, 15 |
| Accounts | `actual_accounts_reopen` | none |
| Accounts | `actual_accounts_update` | none |
| Accounts | `actual_bank_sync` | 14 |
| Account groups | `actual_account_groups_list` | none |
| Account groups | `actual_account_groups_create` | none |
| Account groups | `actual_account_groups_update` | none |
| Account groups | `actual_account_groups_delete` | none |
| Budgets | `actual_budgets_get_all` | 10 |
| Budgets | `actual_budgets_list_available` | 10 |
| Budgets | `actual_budgets_switch` | none |
| Budgets | `actual_budgets_get_month` | 4 |
| Budgets | `actual_budgets_get_months` | 4 |
| Budgets | `actual_budgets_hold_for_next_month` | none |
| Budgets | `actual_budgets_reset_hold` | none |
| Budgets | `actual_budgets_set_amount` | 7 |
| Budgets | `actual_budgets_set_carryover` | 7 |
| Budgets | `actual_budgets_transfer` | 12 |
| Budgets | `actual_budget_updates_batch` | 7 |
| Budgets | `actual_budgets_export` | none |
| Budgets | `actual_budgets_import` | none |
| Categories | `actual_categories_create` | none |
| Categories | `actual_categories_delete` | none |
| Categories | `actual_categories_get` | 15 |
| Categories | `actual_categories_update` | none |
| Category groups | `actual_category_groups_create` | none |
| Category groups | `actual_category_groups_delete` | none |
| Category groups | `actual_category_groups_get` | 15 |
| Category groups | `actual_category_groups_update` | none |
| Payees | `actual_payees_common_list` | 13 |
| Payees | `actual_payees_create` | none |
| Payees | `actual_payees_delete` | none |
| Payees | `actual_payees_get` | 13, 15 |
| Payees | `actual_payees_merge` | none |
| Payees | `actual_payees_update` | none |
| Payees | `actual_payee_rules_get` | 13 |
| Query | `actual_query_run` | 2 |
| Rules | `actual_rules_create` | 6 |
| Rules | `actual_rules_create_batch` | 6 |
| Rules | `actual_rules_create_or_update` | 6 |
| Rules | `actual_rules_delete` | none |
| Rules | `actual_rules_get` | 13 |
| Rules | `actual_rules_update` | none |
| Schedules | `actual_schedules_create` | none |
| Schedules | `actual_schedules_dates` | none |
| Schedules | `actual_schedules_delete` | none |
| Schedules | `actual_schedules_get` | none |
| Schedules | `actual_schedules_update` | none |
| Transactions | `actual_transactions_aggregate` | 1 |
| Transactions | `actual_transactions_create` | 14 |
| Transactions | `actual_transactions_delete` | none |
| Transactions | `actual_transactions_merge` | none |
| Transactions | `actual_transactions_filter` | 2, 3 |
| Transactions | `actual_transactions_get` | 2 |
| Transactions | `actual_transactions_import` | 14 |
| Transactions | `actual_transactions_search_by_amount` | 2 |
| Transactions | `actual_transactions_search_by_category` | 2 |
| Transactions | `actual_transactions_search_by_month` | 2 |
| Transactions | `actual_transactions_search_by_payee` | 2 |
| Transactions | `actual_transactions_summary_by_category` | 1 |
| Transactions | `actual_transactions_summary_by_payee` | 1 |
| Transactions | `actual_transactions_uncategorized` | 3 |
| Transactions | `actual_transactions_update` | 5 |
| Transactions | `actual_transactions_update_batch` | 5 |
| Transfers | `actual_transfers_create` | 12 |
| Server | `actual_server_info` | 9 |
| Server | `actual_server_get_version` | 9 |
| Server | `actual_session_close` | none |
| Server | `actual_session_list` | none |
| Lookup | `actual_get_id_by_name` | 8 |
| Lookup | `actual_entities_search` | 8 |
| Lookup | `actual_get_context` | 9, 15 |
| Tags | `actual_tags_list` | none |
| Tags | `actual_tags_create` | none |
| Tags | `actual_tags_update` | none |
| Tags | `actual_tags_delete` | none |
| Notes | `actual_notes_get` | none |
| Notes | `actual_notes_update` | none |
| Preferences | `actual_preferences_get` | none |

85 rows: 85 tools checked.

## Summary of decisions

| # | Group | Members | Decision |
|---|-------|---------|----------|
| 1 | Totals and summaries | aggregate, account_flow_summary, summary_by_category, summary_by_payee, recurring_expenses_summary | Keep, sharpen descriptions |
| 2 | Finding transactions | filter, search_by_amount, search_by_category, search_by_month, search_by_payee, get, query_run | Keep, sharpen descriptions |
| 3 | Uncategorized | transactions_uncategorized, transactions_filter | Keep, sharpen descriptions |
| 4 | Budget month reads | budgets_get_month, budgets_get_months | Keep, sharpen descriptions |
| 5 | Transaction update | transactions_update, transactions_update_batch | Keep, sharpen descriptions |
| 6 | Rule creation | rules_create, rules_create_or_update, rules_create_batch | Keep, sharpen descriptions |
| 7 | Budget amounts | budgets_set_amount, budget_updates_batch, budgets_set_carryover | Keep, sharpen descriptions |
| 8 | Name to id | get_id_by_name, entities_search | Keep, sharpen descriptions |
| 9 | Context and server info | get_context, server_info, server_get_version | Keep as is |
| 10 | Budget file lists | budgets_get_all, budgets_list_available | Keep, sharpen descriptions |
| 11 | Account balance | accounts_list, accounts_get_balance | Keep, sharpen descriptions |
| 12 | Two kinds of transfer | transfers_create, budgets_transfer | Keep, sharpen descriptions |
| 13 | Payee and rule lookups | payees_get, payees_common_list, rules_get, payee_rules_get | Keep, sharpen descriptions |
| 14 | Adding transactions | transactions_create, transactions_import, bank_sync | Keep, sharpen descriptions |
| 15 | Entity listings | get_context, accounts_list, categories_get, category_groups_get, payees_get | Keep, sharpen descriptions |
| 16 | Close and delete an account | accounts_close, accounts_delete | Keep, sharpen descriptions |

Read and write check (the "Reject" rule). Groups 1 to 4, 8 to 11, 13 and 15 contain only `READ_ONLY` tools. Groups 5 to 7, 12, 14 and 16 contain only tools outside `READ_ONLY`. No group mixes the two, so no candidate was rejected on that ground, and a merge across the line is not proposed anywhere. If a later proposal does cross it, the answer is "Reject: mixes read and write".

## Group details

Names below are written without the `actual_` prefix to keep lines short; the full names are in the table above.

### 1. Totals and summaries

Members: `transactions_aggregate`, `account_flow_summary`, `transactions_summary_by_category`, `transactions_summary_by_payee`, `recurring_expenses_summary`. All `READ_ONLY`.

Which to use:
- Spending or income by month, category, category group, payee or account, with filters: `transactions_aggregate`.
- Why one set of accounts changed by an exact amount (opening, closing, transfers in and out): `account_flow_summary`.
- A quick per-category or per-payee total for a date range, current month by default: `transactions_summary_by_category` and `transactions_summary_by_payee`.
- Subscriptions and bills found from history: `recurring_expenses_summary`.

Decision: Keep, sharpen descriptions. Reason (output shape and rules differ, so not a parameter-only difference):
- `transactions_aggregate` takes `groupBy` (one dimension or up to 5), id filters, excludes split parents, never counts transfers as spending, and reports uncategorized inflows separately (`src/tools/transactions_aggregate.ts:67-75`).
- `account_flow_summary` requires an account set and returns an opening and closing balance with a reconciliation, not groups (`src/tools/account_flow_summary.ts:29-35`).
- The two `summary_by_*` tools are ActualQL aggregations with a fixed grouping and a current-month default (`src/tools/transactions_summary_by_category.ts:14`, `src/tools/transactions_summary_by_payee.ts:14`); they do not share `aggregate`'s split and transfer rules. Replacing them with `aggregate` would change their numbers, which is a behaviour change, not a merge.

Sentences to add:
- In both `summary_by_*` descriptions: "For splits, transfers, several dimensions or id filters use actual_transactions_aggregate; this tool is a quick single-dimension total."
- In `transactions_aggregate`: "To explain a balance change with opening and closing balances use actual_account_flow_summary."
- In `account_flow_summary`: "For spending by category, payee or month use actual_transactions_aggregate."

### 2. Finding transactions

Members: `transactions_filter`, `transactions_search_by_amount`, `transactions_search_by_category`, `transactions_search_by_month`, `transactions_search_by_payee`, `transactions_get`, `query_run`. All `READ_ONLY`.

Which to use:
- By ids, with date range, amount range, notes text, cleared or reconciled, no row limit: `transactions_filter`.
- By a payee name: `transactions_search_by_payee`. By a category name: `transactions_search_by_category`. One calendar month: `transactions_search_by_month`. By an amount, including the sign-blind `absoluteAmount`: `transactions_search_by_amount`.
- Everything of one account or all accounts in a date range, no other filter: `transactions_get`.
- Anything else, joins, or ad hoc selection: `query_run`.

Decision: Keep, sharpen descriptions. Reasons from the source:
- Scope: `search_by_payee` includes off-budget accounts (`src/tools/transactions_search_by_payee.ts:19`); `search_by_category`, `search_by_month` and `filter` exclude them (`src/tools/transactions_search_by_category.ts:18`, `src/tools/transactions_search_by_month.ts:18`, `src/tools/transactions_filter.ts:23`). Folding them together would change results for one side.
- Identifier type: `filter` takes ids and refuses names (`transactions_filter.ts:22-23`); the search tools take case-insensitive exact names.
- Output shape: the search tools return `{ transactions, count, totalAmount, <name> }` with a default `limit` of 100, where `count` and `totalAmount` cover only the returned rows; `filter` and `get` return `{ result }` with no limit.
- A merge of the three name searches would need `by: "payee"` style injected arguments, so it would first need the alias extension ticket described above, and the scope difference still blocks it.

Sentences to add:
- `search_by_payee`: "Includes off-budget accounts, unlike actual_transactions_search_by_category, actual_transactions_search_by_month and actual_transactions_filter."
- Each search tool: "count and totalAmount cover only the returned rows (limit default 100); for exact totals use actual_transactions_aggregate."
- `search_by_amount`: "Requires accountId or a date range."
- `transactions_get`: "Use this only when no filter beyond account and dates is needed."

### 3. Uncategorized

Members: `transactions_uncategorized`, `transactions_filter`. Both `READ_ONLY`.

Which to use: `transactions_uncategorized` to see what needs categorizing (a summary by account, optional paginated rows); `transactions_filter` for any other criteria.

Decision: Keep, sharpen descriptions. Reason: `uncategorized` returns a summary by default (`totalCount`, `totalAmount`, `byAccount`) and excludes transfers, split parents, opening balances, off-budget and closed accounts (`src/tools/transactions_uncategorized.ts:44-52`); `filter` returns raw rows and has no "uncategorized" selector. Different output shape and exclusions.

Sentence to add to `transactions_uncategorized`: "For other transaction criteria use actual_transactions_filter."

### 4. Budget month reads

Members: `budgets_get_month`, `budgets_get_months`. Both `READ_ONLY`.

Which to use: `budgets_get_months` to see which months exist and their totals; `budgets_get_month` for the per-category detail of one month.

Decision: Keep, sharpen descriptions. Reason: output shape. `get_month` returns every category with budgeted, spent and balance (`src/tools/budgets_get_month.ts:16-17`); `get_months` returns totals only per month (`src/tools/budgets_get_months.ts:11`). Merging would make the response size depend on a parameter and hide the cheap call.

Sentence to add to `budgets_get_months`: "Totals only; for the categories of one month use actual_budgets_get_month."

### 5. Transaction update

Members: `transactions_update`, `transactions_update_batch`. Both write tools.

Which to use: `transactions_update` for one transaction, and the only one that can split in place. `transactions_update_batch` for up to 50 independent field edits.

Decision: Keep, sharpen descriptions. Reason: different contracts, not one parameter. The batch is non-atomic, reports per-item `failed`, and does not support splits (`src/tools/transactions_update_batch.ts:53`); the single update supports `fields.subtransactions` and fails as a whole (`src/tools/transactions_update.ts:43-47`). A merged tool would have two failure modes behind one name.

Sentences to add:
- `transactions_update`: "For many transactions without splits use actual_transactions_update_batch."
- `transactions_update_batch`: "To split a transaction use actual_transactions_update."

### 6. Rule creation

Members: `rules_create`, `rules_create_or_update`, `rules_create_batch`. All write tools.

Which to use: `rules_create` for one new rule; `rules_create_or_update` to avoid duplicates when conditions may already exist; `rules_create_batch` for 1 to 50 new rules.

Decision: Keep, sharpen descriptions. Reason: `create_or_update` REPLACES the actions of an existing rule with the same conditions and returns `{ id, created }` (`src/tools/rules_create_or_update.ts:71-76`), a different and riskier effect than create; `create_batch` is non-atomic with per-item `failed` and no automatic retry (`src/tools/rules_create_batch.ts:25-29`). These are different semantics, not a parameter.

Sentences to add:
- `rules_create`: "Always adds a new rule, even if one with the same conditions exists; use actual_rules_create_or_update to avoid duplicates."
- `rules_create_or_update`: "Overwrites the actions of a rule with the same conditions."

### 7. Budget amounts

Members: `budgets_set_amount`, `budget_updates_batch`, `budgets_set_carryover`. All write tools.

Which to use: `budgets_set_amount` for one category and month; `budgets_set_carryover` for one carryover flag; `budget_updates_batch` for many month and category pairs, amounts and carryover together, up to 100.

Decision: Keep, sharpen descriptions. Reason: `set_amount` fails as a tool error on a bad month or category, while the batch reports per-item failures as a normal result and may leave an amount applied when its carryover fails (`src/tools/budget_updates_batch.ts:38-42`; `src/tools/budgets_set_amount.ts:20-24`). Different failure contract, so not a parameter-only difference.

Sentences to add:
- `budgets_set_amount`: "For many months or categories use actual_budget_updates_batch."
- `budget_updates_batch`: "For a single amount use actual_budgets_set_amount."

### 8. Name to id

Members: `get_id_by_name`, `entities_search`. Both `READ_ONLY`.

Which to use: `get_id_by_name` when the exact name is known, for accounts, schedules, categories or payees. `entities_search` when the name is partial or mistyped (contains, startsWith, endsWith, exact or fuzzy), for accounts, categories or payees.

Decision: Keep, sharpen descriptions. Reason: different entity sets (schedules only in `get_id_by_name`, `src/tools/get_id_by_name.ts:19-24`, `ALLOWED_TYPES` at line 5) and different matching and output (`src/tools/entities_search.ts:48-52`, match modes and a `matches` list). Not one entity set.

Sentences to add:
- `get_id_by_name`: "Exact name only; for a partial or mistyped name use actual_entities_search."
- `entities_search`: "For schedules, or when the exact name is known, use actual_get_id_by_name."

### 9. Context and server info

Members: `get_context`, `server_info`, `server_get_version`. All `READ_ONLY`.

Decision: Keep as is. The overlap is only apparent: `get_context` returns budget structure and ids (`src/tools/get_context.ts:36-39`), `server_info` describes the MCP server (name, transport, runtime), and `server_get_version` returns the version of the Actual Budget server and already points to `server_info` for MCP details (`src/tools/server_get_version.ts:9-14`). They return different entities, so there is no merge and the descriptions already separate them.

### 10. Budget file lists

Members: `budgets_get_all`, `budgets_list_available`. Both `READ_ONLY`.

Which to use: `budgets_list_available` for the budgets configured for this server that you can switch to with `budgets_switch`; `budgets_get_all` for the budget files that exist on the Actual server.

Decision: Keep, sharpen descriptions. Reason: different entity sets. `get_all` lists server files filtered by the caller's allowed budgets (`src/tools/budgets_get_all.ts:10`; `getBudgets` in `src/lib/actual-adapter.ts`); `list_available` lists the budgets configured through `BUDGET_n_*` variables with name, sync id, origin and encryption flag (`src/tools/budgets_list_available.ts:9-13`).

Sentences to add:
- `budgets_get_all`: "Lists files on the Actual server; to choose a budget for actual_budgets_switch use actual_budgets_list_available."
- `budgets_list_available`: "Lists configured budgets, not every file on the server (see actual_budgets_get_all)."

### 11. Account balance

Members: `accounts_list`, `accounts_get_balance`. Both `READ_ONLY`.

Which to use: `accounts_list` for all accounts with current balances. `accounts_get_balance` for one account, or its balance at a past date (`cutoff`).

Decision: Keep, sharpen descriptions. Reason: `get_balance` has a `cutoff` date and a single-account result (`src/tools/accounts_get_balance.ts:23-31`); `list` returns every account with current balance and open and off-budget flags (`src/tools/accounts_list.ts:23`). Different scope and output shape.

Sentences to add:
- `accounts_list`: "Balances are current; for a balance on a past date use actual_accounts_get_balance with cutoff."
- `accounts_get_balance`: "For all accounts at once use actual_accounts_list."

### 12. Two kinds of transfer

Members: `transfers_create`, `budgets_transfer`. Both write tools.

Which to use: `transfers_create` moves money between two accounts (a paired transaction). `budgets_transfer` moves budgeted money between two categories in one month. Neither moves the other's kind of value.

Decision: Keep, sharpen descriptions. Reason: different entities entirely (accounts and transactions versus categories and budget amounts), so it is a naming trap, not an overlap to merge (`src/tools/transfers_create.ts:13-17`, `src/tools/budgets_transfer.ts:23`).

Sentences to add:
- `transfers_create`: "Moves money between accounts. To move budgeted money between categories use actual_budgets_transfer."
- `budgets_transfer`: "Moves budget between categories, not money between accounts; for that use actual_transfers_create."

### 13. Payee and rule lookups

Members: `payees_get`, `payees_common_list`, `rules_get`, `payee_rules_get`. All `READ_ONLY`.

Which to use: `payees_get` for all payees; `payees_common_list` for the most used recently (top 10, last about 12 weeks); `rules_get` for every rule; `payee_rules_get` for the rules of one payee.

Decision: Keep, sharpen descriptions. Reason: different scope in each pair. `payees_common_list` is a recency-filtered top 10 and already says it differs from `payees_get` (`src/tools/payees_common_list.ts:7-10`); `payee_rules_get` is scoped to one payee id and already points to `rules_get` (`src/tools/payee_rules_get.ts:14`, `src/tools/rules_get.ts:10-11`). The only gap is that `payees_get` does not point back.

Sentence to add to `payees_get`: "For only the most frequently used payees use actual_payees_common_list."

### 14. Adding transactions

Members: `transactions_create`, `transactions_import`, `bank_sync`. All write tools.

Which to use: `transactions_create` for a transaction the user describes. `transactions_import` for rows from a bank file, with rules applied and duplicates matched. `bank_sync` to pull from a linked bank through GoCardless or SimpleFIN.

Decision: Keep, sharpen descriptions. Reason: different behaviour. `import` applies rules and matches existing rows by `imported_id` or amount within 7 days (`src/tools/transactions_import.ts:37-38`); `create` adds a row as given (`src/tools/transactions_create.ts:47-50`); `bank_sync` reaches a third party and is the only open-world tool (`OPEN_WORLD` in `src/lib/tool-annotations.ts`). Merging `bank_sync` with the others would also hide its network effect.

Sentences to add:
- `transactions_create`: "Applies no import rules or duplicate matching; for bank-file rows use actual_transactions_import."
- `transactions_import`: "Takes rows you already have; to fetch from the bank use actual_bank_sync."

### 15. Entity listings

Members: `get_context`, `accounts_list`, `categories_get`, `category_groups_get`, `payees_get`. All `READ_ONLY`.

Which to use: `get_context` to bootstrap ids for accounts, category groups with nested categories, and up to 500 payees in one call; the single-entity tools when one list is enough or the full detail of one kind is needed.

Decision: Keep, sharpen descriptions. Reason: `get_context` is explicitly a bundle with a size cap and excludable sections (`src/tools/get_context.ts:36-39`); the single tools return one entity set with full detail. Same data, different shape and size; merging would force callers to pay for the bundle.

Sentence to add to `categories_get`, `category_groups_get`, `payees_get` and `accounts_list`: "To get accounts, categories and payees in one call use actual_get_context."

### 16. Close and delete an account

Members: `accounts_close`, `accounts_delete`. Both write tools; both `DESTRUCTIVE`.

Decision: Keep, sharpen descriptions. Reason: `accounts_close` REMOVES an account that has no transactions instead of closing it (`src/tools/accounts_close.ts:45-48`), which makes the two look alike, but close keeps history and can be reopened with `accounts_reopen`, while delete cannot. The effect on an empty account is the same; on an account with transactions it differs, so the choice is about intent.

Sentence to add to `accounts_delete`: "To keep history and allow reopening use actual_accounts_close, which keeps an account that has transactions."

## Accepted merges

None. No group meets the Merge rubric, so no merge ticket is filed.

If a later review accepts a merge, add one entry per merge here in this form and file one ticket for it:

```
### Merge N: <surviving tool>
Members: <tools merged>
Removed names: <names>
Alias-only or needs injected arguments: <which>
Follow-up: (ticket to file)
```

## Description sharpening

The sentences listed per group above are the work for the 15 "Keep, sharpen descriptions" groups. Description edits must keep `tests/unit/tool_description_checklist.test.js` and the tools/list size ceiling green.

Follow-up: #659

## Totals

| Item | Count |
|------|-------|
| `IMPLEMENTED_TOOLS` today | 85 |
| Names removed by accepted merges | 0 |
| Expected `IMPLEMENTED_TOOLS` after all accepted merges | 85 - 0 = 85 |

Each accepted merge of N tools would be net -(N-1). With no accepted merges the total is unchanged.
