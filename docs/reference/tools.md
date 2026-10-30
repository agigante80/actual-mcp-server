# Tools reference

Every tool the server registers, grouped by domain, with the caveats you need before calling it. All tools use the `actual_<category>_<action>` naming convention. Amounts are integer cents and dates are `YYYY-MM-DD` strings throughout.

Which tools a client actually sees depends on `MCP_TOOLSETS`, `MCP_TOOLS` and `MCP_READ_ONLY`; the toolset sizes are in the README's [Reducing the tool surface](../../README.md#reducing-the-tool-surface) table and every variable is in the [configuration reference](configuration.md).

## Accounts

| Tool | Description |
|------|-------------|
| `actual_accounts_list` | List all accounts |
| `actual_accounts_create` | Create new account |
| `actual_accounts_update` | Update account details. An id that does not exist is refused rather than creating a partial record |
| `actual_accounts_delete` | Permanently delete account |
| `actual_accounts_close` | Close account. An account with NO transactions is REMOVED by Actual, not closed |
| `actual_accounts_reopen` | Reopen closed account. An id that is not an account is refused rather than creating one |
| `actual_accounts_get_balance` | Get account balance at a date |
| `actual_account_flow_summary` | Explain the exact balance change across a set of accounts over a date range: external income, expense outflow, credits, uncategorized inflows, and transfers into, out of, or within the selection, with an exact reconciliation |
| `actual_account_groups_list` | List the custom account groups used to organise accounts in the sidebar (Actual 26.9.0+) |
| `actual_account_groups_create` | Create an account group. Assigning accounts to it is a separate `actual_accounts_update` call |
| `actual_account_groups_update` | Rename an account group or change its sidebar position. A group that does not exist is refused, writing nothing |
| `actual_account_groups_delete` | Delete an account group. Its accounts are NOT deleted, they become ungrouped |

## Transactions

**Standard**

| Tool | Description |
|------|-------------|
| `actual_transactions_get` | Get transactions for an account |
| `actual_transactions_filter` | Filter with advanced criteria |
| `actual_transactions_create` | Create new transaction(s), including splits (pass a `subtransactions` array) |
| `actual_transactions_import` | Import and reconcile transactions |
| `actual_transactions_update` | Update a transaction, split a plain one in place, or edit the children of an existing split via `subtransactions` |
| `actual_transactions_delete` | Delete a transaction |
| `actual_transactions_merge` | Merge two same-account, same-amount transactions (e.g. a bank-imported duplicate and a manual entry). Upstream keeps one (the imported one first) and DELETES the other, filling only the kept row's empty payee, category, notes and schedule and its false cleared and reconciled flags; irreversible |

> **Split transactions:** pass a `subtransactions` array (each child needs an `amount` in integer cents; `category` and `notes` are optional). The child amounts must sum to the parent `amount` (the server does not enforce this, so the tool does). A split parent carries no category of its own: put categories on the children. `actual_transactions_update` with `subtransactions` edits the children of a transaction that is already a split, or splits a plain transaction IN PLACE: it keeps its id, `imported_id` and cleared state, so a bank-synced transaction can be split without breaking import matching. Its own category is cleared, and a child that names no category inherits it. A split child cannot itself be split. Note: `actual_transactions_import` forwards a `subtransactions` array to the API but does NOT apply the sum check, so use `actual_transactions_create` for guaranteed-balanced splits.

**Utility**

| Tool | Description |
|------|-------------|
| `actual_transactions_uncategorized` | Summary of uncategorized transactions (totalCount, totalAmount, per-account breakdown); pass `includeTransactions:true` for paginated rows |
| `actual_transactions_update_batch` | Apply many transaction updates in ONE call (`updates: [{ id, fields }]`); returns per-item success and failure counts |

**Exclusive ActualQL-powered**, unique to this MCP server

| Tool | Description |
|------|-------------|
| `actual_transactions_aggregate` | Deterministic integer-cent totals grouped by month, category, category group, payee, or account; transfers excluded via `transfer_id` and split children counted once |
| `actual_transactions_search_by_month` | Search by month using `$month` transform |
| `actual_transactions_search_by_amount` | Find by amount range |
| `actual_transactions_search_by_category` | Search by category name |
| `actual_transactions_search_by_payee` | Find by payee/vendor |
| `actual_transactions_summary_by_category` | Spending summary grouped by category |
| `actual_transactions_summary_by_payee` | Top vendors with totals and counts |
| `actual_recurring_expenses_summary` | Detect recurring charges (subscriptions, bills) from posted history: cadence (with date-drift and month-end tolerance), latest amount, price changes, occurrences, annualized cost, and active or inactive state |

## Transfers

| Tool | Description |
|------|-------------|
| `actual_transfers_create` | Create a paired transfer between two accounts (debit + credit linked by `transfer_id`, identical to UI "Make Transfer") |

> **Note:** Use `actual_transfers_create` for any account-to-account movement, not `actual_transactions_create`. The dedicated tool creates both sides (debit and credit) atomically so the books stay balanced. Limitations: both accounts must exist and be open, and `from_account` must differ from `to_account`.

## Categories

`actual_categories_get` · `actual_categories_create` · `actual_categories_update` · `actual_categories_delete`

## Category Groups

`actual_category_groups_get` · `actual_category_groups_create` · `actual_category_groups_update` · `actual_category_groups_delete`

## Payees

`actual_payees_get` · `actual_payees_common_list` · `actual_payees_create` · `actual_payees_update` · `actual_payees_delete` · `actual_payees_merge` · `actual_payee_rules_get`

## Tags

`actual_tags_list` · `actual_tags_create` · `actual_tags_update` · `actual_tags_delete`

| Tool | Description |
|------|-------------|
| `actual_tags_list` | List all tags (id, tag word, optional color and description) |
| `actual_tags_create` | Create or upsert a tag by name; returns the tag UUID |
| `actual_tags_update` | Update tag name, color, or description by UUID |
| `actual_tags_delete` | Soft-delete a tag by UUID |

## Notes

`actual_notes_get` · `actual_notes_update`

| Tool | Description |
|------|-------------|
| `actual_notes_get` | Get the note for any entity (account/category/category-group/payee UUID, or budget-YYYY-MM) |
| `actual_notes_update` | Set or clear the note for any entity; validates entity exists or matches budget-YYYY-MM pattern |

## Preferences

| Tool | Description |
|------|-------------|
| `actual_preferences_get` | Read the budget's synced display preferences (number format, date format, currency, first day of week). Display only: all amounts stay integer cents |

## Budgets

| Tool | Description |
|------|-------------|
| `actual_budgets_list_available` | List all configured budget files |
| `actual_budgets_switch` | Switch active budget (multi-budget) |
| `actual_budgets_get_all` | List available budget files |
| `actual_budgets_getMonths` | List budget months |
| `actual_budgets_getMonth` | Get budget for a specific month |
| `actual_budgets_setAmount` | Set category budget amount. The month must be one the budget has (see `actual_budgets_getMonths`) |
| `actual_budgets_transfer` | Transfer amount between categories |
| `actual_budgets_setCarryover` | Enable/disable carryover |
| `actual_budgets_holdForNextMonth` | Hold funds for next month. Actual clamps the hold to what is left to budget, so the response reports the amount actually held |
| `actual_budgets_resetHold` | Reset hold status |
| `actual_budgets_export` | Export the active budget as a `.zip` into `ACTUAL_EXPORT_DIR`; returns path, byte size and sha256, never the file contents |
| `actual_budgets_import` | Restore a budget from an Actual `.zip` or a YNAB4/YNAB5 export. **Destructive:** the budget id comes from the archive, so re-importing an export *replaces* that budget's data rather than making a copy. Also loads the imported budget, changing the session's active budget |

## Rules

`actual_rules_get` · `actual_rules_create` · `actual_rules_update` · `actual_rules_delete`

| Tool | Description |
|------|-------------|
| `actual_rules_create_or_update` | Idempotent upsert: create a rule, or update the existing one that matches the same conditions, in a single call. Use this instead of get-then-create when re-running a categorisation setup, so repeated runs do not pile up duplicate rules |
| `actual_rules_create_batch` | Create 1 to 50 rules in one call, each exactly the input of `actual_rules_create`. Best-effort, not atomic (see Batch Operations): a rule that fails its own checks, names a category, payee or account that does not exist, or is rejected by Actual is reported with its index while the rest continue |

## Schedules

| Tool | Description |
|------|-------------|
| `actual_schedules_get` | List scheduled transactions, with their next occurrence date |
| `actual_schedules_create` | Create a schedule (one-off or recurring); recurrence is a typed config, see `src/lib/schemas/recur.ts` |
| `actual_schedules_update` | Update an existing schedule's amount, payee, account, or recurrence |
| `actual_schedules_delete` | Delete a schedule |

## Advanced Query & Sync

| Tool | Description |
|------|-------------|
| `actual_query_run` | Execute custom ActualQL query |
| `actual_bank_sync` | Trigger bank sync (GoCardless/SimpleFIN) |

## Batch Operations

Four tools take many items in one call, for clients that allow only a few tool calls per turn. They share ONE contract: each item is applied independently and **not atomically**. There is no rollback, so items applied before a failure stay applied; a bad item is reported by its index and the rest continue; an infrastructure failure (lost connection, timeout) fails the whole call, and then you must read the data back before retrying anything. A bulk path never retries a create on its own.

- `actual_transactions_update_batch` (counted under Transactions): update up to 50 transactions, `{id, fields}` each. Result: `{ succeeded: [{id}], failed: [{id, error}], total, successCount, failureCount }`. Items marked "not attempted" were never sent. Re-read with `actual_transactions_get` before retrying any item.
- `actual_transactions_import` (counted under Transactions): bulk create with import semantics (deduplication and reconciliation against existing transactions, rules optionally applied). Use it to add many transactions at once.
- `actual_budget_updates_batch`: set budget amounts and/or carryover flags for 1 to 100 month/category pairs, and the way to rebalance categories: read the month with `actual_budgets_getMonth`, then send one batch of absolute amounts. Each operation needs at least one of `amount` (integer cents) or `carryover`. Result: `{ succeeded: [{index, month, categoryId}], failed: [{index, month, categoryId, error}], total, successCount, failureCount }`. An unknown category, an out-of-range month or a carryover on an income category fails only that item. After a timeout, read the months back with `actual_budgets_getMonth` before retrying.
- `actual_rules_create_batch` (counted under Rules): create 1 to 50 rules, each exactly the input of `actual_rules_create`. Result: `{ succeeded: [{index, id}], failed: [{index, error}], total, successCount, failureCount }`. Items marked "not attempted" were never sent. Re-read with `actual_rules_get` before retrying any item.

## Server Information & Lookup

| Tool | Description |
|------|-------------|
| `actual_server_info` | Server status, version, build info |
| `actual_server_get_version` | Actual Budget server version |
| `actual_get_context` | Retrieve open accounts, category groups with nested categories, and payees (name-sorted, capped by `payeeLimit`) in a single call |
| `actual_get_id_by_name` | Resolve an exact name → UUID for accounts, categories, payees |
| `actual_entities_search` | Find accounts/categories/payees by a name pattern (contains/startsWith/endsWith/exact/fuzzy). Fixes "payee not found" from a partial or mistyped name |

## Session Management

| Tool | Description |
|------|-------------|
| `actual_session_list` | List your own active MCP sessions with their activity status; the pool totals cover every session. Stays available under `MCP_READ_ONLY=true` |
| `actual_session_close` | Close one of your own idle sessions (never the current one, partial id match) to free a slot after "Max concurrent sessions reached"; with no id it closes your oldest idle session |

These two manage the session pool itself, not budget data.

