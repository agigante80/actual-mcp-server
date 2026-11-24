# Tools reference

Every tool the server registers, grouped by domain, with the caveats you need before calling it. The server publishes 15 tools over 85 operations by default: the 85 operations (the legacy `actual_<category>_<action>` tools) are described by domain below, and the [compact surface](#compact-surface) that fronts them is at the end. Set `MCP_TOOL_SURFACE=legacy` to publish the 85 `actual_*` tools instead. Amounts are integer cents and dates are real calendar days written `YYYY-MM-DD`; an impossible day such as `2026-02-30` is refused (a schedule recurrence's `start` and `endDate` are checked for shape only).

The README's [Tools section](../../README.md#tools) is the generated overview (the 15 compact tools by domain, the prompts and the measured `tools/list` sizes); this page is the full per-operation reference behind it.

Which tools a client actually sees depends on `MCP_TOOLSETS`, `MCP_TOOLS`, `MCP_READ_ONLY` and `MCP_TOOL_SURFACE` (`compact` by default since #680; the `actual_*` tools listed below are published only when it is `legacy` or `all`, and the compact tools only when it is `compact` or `all`); the toolset sizes are in the README's [Reducing the tool surface](../../README.md#reducing-the-tool-surface) table and every variable is in the [configuration reference](configuration.md).

## Accounts

`actual_accounts_list` and `actual_accounts_get_balance` publish an MCP `outputSchema` (a root `type: "object"` JSON Schema in `tools/list`) and return `structuredContent` equal to the parsed text block, alongside the unchanged text block, over HTTP and stdio. Clients that do not read `structuredContent` see exactly what they saw before. If a result ever fails its own schema, the call returns the text block with `isError: true` and no `structuredContent`, and the server logs the tool name and the failing paths (never values). Every other tool still returns the text block only.

| Tool | Description |
|------|-------------|
| `actual_accounts_list` | List all accounts |
| `actual_accounts_create` | Create a new account, on-budget unless offbudget is true, optionally with an opening balance in integer cents |
| `actual_accounts_update` | Update account details, including `account_group_id` (a group id, or null to ungroup). An id that does not exist is refused rather than creating a partial record, and so is an unknown group |
| `actual_accounts_delete` | Permanently delete account; the result reports detachedTransfers, the transfers left unlinked in other accounts; an id that does not exist is refused |
| `actual_accounts_close` | Close account. An account with NO transactions is REMOVED by Actual, not closed. A balance moved from an on-budget to an off-budget account needs transferCategoryId; refused for any other pairing |
| `actual_accounts_reopen` | Reopen closed account. An id that is not an account is refused rather than creating one |
| `actual_accounts_get_balance` | Get account balance at a date |
| `actual_account_flow_summary` | Explain the exact balance change across a set of accounts over a date range: external income, expense outflow, credits, uncategorized inflows, and transfers into, out of, or within the selection, with an exact reconciliation |
| `actual_account_groups_list` | List the custom account groups used to organise accounts in the sidebar (Actual 26.9.0+) |
| `actual_account_groups_create` | Create an account group. Assign an account with `actual_accounts_update` `account_group_id` |
| `actual_account_groups_update` | Rename an account group (`name` is required). A group that does not exist is refused, writing nothing |
| `actual_account_groups_delete` | Delete an account group. Its accounts are NOT deleted, they become ungrouped |

## Transactions

**Standard**

| Tool | Description |
|------|-------------|
| `actual_transactions_get` | List the transactions of one account, or of all accounts, optionally by date range |
| `actual_transactions_filter` | Filter with advanced criteria |
| `actual_transactions_create` | Create new transaction(s), including splits (pass a `subtransactions` array; an unknown account, payee or category id, a transfer payee, or a `payee_name` shared by two or more payees, returns `success: false` and writes nothing) |
| `actual_transactions_import` | Import and reconcile transactions (a `payee_name` shared by two or more payees is refused with their ids and nothing in the batch is written; a transfer payee never matches) |
| `actual_transactions_update` | Update a transaction (`payee` takes a payee id or `null`; `payee_name` matches an existing payee case-insensitively or creates one; a name in `payee`, both fields, or a blank name is refused), split a plain one in place, or edit the children of an existing split via `subtransactions` (a parent amount or a child amount alone is refused unless the children still sum to the parent); an unknown payee or category id is refused and nothing changes; `fields` needs at least one key (`update needs at least one field to change besides id`) |
| `actual_transactions_delete` | Delete a transaction (a split child is refused when the remaining children would stop summing to the parent; a sole child can go) |
| `actual_transactions_merge` | Merge two same-account, same-amount transactions (e.g. a bank-imported duplicate and a manual entry). Upstream keeps one (the imported one first) and DELETES the other, filling only the kept row's empty payee, category, notes and schedule and its false cleared and reconciled flags; irreversible. Two rows that point at the same transfer counterpart are refused |

> **Split transactions:** pass a `subtransactions` array (each child needs an `amount` in integer cents; `category` and `notes` are optional). The child amounts must sum to the parent `amount` (the server does not enforce this, so the tool does). A split parent carries no category of its own: put categories on the children. `actual_transactions_update` with `subtransactions` edits the children of a transaction that is already a split, or splits a plain transaction IN PLACE: it keeps its id, `imported_id` and cleared state, so a bank-synced transaction can be split without breaking import matching. Its own category is cleared, and a child that names no category inherits it. A split child cannot itself be split. Note: `actual_transactions_import` forwards a `subtransactions` array to the API but does NOT apply the sum check, so use `actual_transactions_create` for guaranteed-balanced splits.

**Utility**

| Tool | Description |
|------|-------------|
| `actual_transactions_uncategorized` | Summary of uncategorized transactions (totalCount, totalAmount, per-account breakdown); pass `includeTransactions:true` for paginated rows |
| `actual_transactions_update_batch` | Apply many transaction updates in ONE call (`updates: [{ id, fields }]`, `payee` and `payee_name` as in `actual_transactions_update`; a refused item, including an unknown payee or category id, lands in `failed`); returns per-item success and failure counts; each item's `fields` is strict and needs at least one key, so an unknown key (`subtransactions`, `imported_id`, `reconciled` and `transfer_id` included) or an empty `fields` refuses the whole call before anything is written |

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

Creating or moving a category (`actual_categories_create`, `actual_categories_update`) with a `group_id` that is no category group is refused with a not-found refusal; nothing is written.

A category takes its group's `is_income` when none is given (a category created in an income group is an income category). An `is_income` that contradicts the group is refused with a conflict refusal, and so is a move to a group of the other kind without `is_income`; pass `is_income` together with `group_id` to change both. Nothing is written in either case.

## Category Groups

`actual_category_groups_get` · `actual_category_groups_create` · `actual_category_groups_update` · `actual_category_groups_delete`

`actual_category_groups_create` with `is_income: true` stores an income group, but is refused when the budget already has one, since Actual counts only the first income group (upstream's create drops the flag, so the adapter sets it afterwards and verifies it; when it cannot, the group is deleted and the call fails).

## Payees

`actual_payees_get` · `actual_payees_common_list` · `actual_payees_create` (stores `notes`) · `actual_payees_update` (refuses a rename of a transfer payee) · `actual_payees_delete` · `actual_payees_merge` · `actual_payee_rules_get`

## Tags

`actual_tags_list` · `actual_tags_create` · `actual_tags_update` · `actual_tags_delete`

**How tags work.** A tag is the `#word` in a transaction's notes. To tag a transaction, write the `#word` into its notes (`manage_transactions`, or `actual_transactions_create` and `actual_transactions_update`); no tag tool takes a transaction. The tag list these tools manage only holds a colour and a description per word, so a tag used only in notes is not listed, and renaming a list entry does not change the notes, which keep the old `#word`. A notes search is a case-insensitive substring match: `#trip` also finds `#tripod`. A rule can match on tags: on `notes` and `payee_name`, the condition operators `hasTags` (every tag listed) and `hasAnyTag` (at least one) take one string of tags such as `"#trip #food"` and match whole tags in any case, so `#trip` does not match `#tripod`. `imported_payee` refuses them, and a value with no tag in it is refused: upstream would store it and the rule would then act on every transaction that has notes.

| Tool | Description |
|------|-------------|
| `actual_tags_list` | List the tag list (id, tag word, optional color and description). Tags used only in notes are not listed |
| `actual_tags_create` | Create or upsert a tag by name; returns the tag UUID. A repeat create keeps the colour and description it does not supply; a deleted name is revived with only the supplied fields |
| `actual_tags_update` | Update tag name, color, or description by UUID. A rename onto a name another tag has (live or deleted) is refused and nothing is written. A rename does not change transaction notes |
| `actual_tags_delete` | Soft-delete a tag by UUID |

## Notes

`actual_notes_get` · `actual_notes_update`

| Tool | Description |
|------|-------------|
| `actual_notes_get` | Get the note for any entity (account/category/category-group/payee UUID, or budget-YYYY-MM) |
| `actual_notes_update` | Set or clear the note for any entity; validates entity exists or matches budget-YYYY-MM pattern; an unknown id is refused as not found |

## Preferences

| Tool | Description |
|------|-------------|
| `actual_preferences_get` | Read the budget's synced display preferences (number format, date format, currency, first day of week). Display only: all amounts stay integer cents |

## Budgets

| Tool | Description |
|------|-------------|
| `actual_budgets_list_available` | List the budgets visible to this session; the row with `active: true` is this session's budget. In discovery mode, a row marked `locked` is encrypted, has no key on this server and cannot be switched to. |
| `actual_budgets_switch` | Switch active budget (multi-budget). Takes effect at once in this session; other open sessions keep theirs; remembered per caller, so a new session of the same caller starts on it (holders of the one legacy bearer token are one caller). The name must be exact (case-insensitive), not partial |
| `actual_budgets_get_all` | List available budget files |
| `actual_budgets_get_months` | List budget months |
| `actual_budgets_get_month` | Get budget for a specific month |
| `actual_budgets_set_amount` | Set category budget amount. The month must be one the budget has (see `actual_budgets_get_months`). An income category is refused on an envelope budget (it has no budgeted amount there; a tracking budget accepts it). The amount is at most 2251799813685247 either way |
| `actual_budgets_transfer` | Transfer amount between categories. Both must be expense categories (an income category is refused before any write), and the target may not end above 2251799813685247 |
| `actual_budgets_set_carryover` | Enable/disable carryover |
| `actual_budgets_hold_for_next_month` | Hold funds for next month. Actual clamps the hold to what is left to budget, so the response reports the amount actually held |
| `actual_budgets_reset_hold` | Release the amount held for next month (undoes `actual_budgets_hold_for_next_month`) |
| `actual_budgets_export` | Export the active budget as a `.zip` into `ACTUAL_EXPORT_DIR`; returns path, byte size and sha256, never the file contents |
| `actual_budgets_import` | Restore a budget from an Actual `.zip` or a YNAB4/YNAB5 export. **Adds a budget, replaces none:** each import makes a new local copy and normally uploads it as a new server budget file that no tool here can remove. The session stays on its own configured budget; to use the imported budget an operator adds its Sync ID to the configuration and restarts |

### Deprecated names

Until v0.28.0 six budget tools had camelCase names. The old names still work as hidden aliases: a call or an `MCP_TOOLS` entry using one runs the new tool, under the same `MCP_READ_ONLY` and `MCP_TOOLSETS` rules, and the server logs one warning. They are not listed in `tools/list` and are removed in the first minor release after 2027-02-01. Re-select saved tool selections (for example in LibreChat) and re-approve the new names in Claude Desktop.

| Old name | New name |
|----------|----------|
| `actual_budgets_getMonth` | `actual_budgets_get_month` |
| `actual_budgets_getMonths` | `actual_budgets_get_months` |
| `actual_budgets_setAmount` | `actual_budgets_set_amount` |
| `actual_budgets_setCarryover` | `actual_budgets_set_carryover` |
| `actual_budgets_holdForNextMonth` | `actual_budgets_hold_for_next_month` |
| `actual_budgets_resetHold` | `actual_budgets_reset_hold` |

## Rules

`actual_rules_get` · `actual_rules_create` · `actual_rules_update` · `actual_rules_delete`

**Condition values.** A condition is `{field, op, value[, type, options]}`. `options` is `{outflow: true}` or `{inflow: true}` (not both), on `amount` only, with a positive value (the direction comes from the option); it is stored and applied, and it is part of the upsert identity (`{outflow: false}` equals no options). Any other key in a condition or an action is refused by name (an action's own `options` object stays open). The value is text or a number for most operators. `oneOf` and `notOneOf` take a non-empty array: ids on `payee`, `account`, `category` and `category_group`, text on `imported_payee` and `payee_name`. An array on any other operator is refused. `cleared` and `reconciled` take `is` with `true` or `false`; a boolean on any other field is refused. `amount` `isbetween` takes `{num1, num2}` in integer cents (the bounds in either order), and no other operator takes an object. `account` `onBudget` and `offBudget` take the value `""`. The same holds for `manage_rules`.

**Rule lists and set values.** `conditions` and `actions` must each hold at least one item, on create, update (when the key is sent), upsert and every `create_batch` item; a batch item that breaks this goes to `failed` and the rest are still created. An update that omits a list keeps the stored one. A `set` action's value must suit its field: integer cents for `amount`, a real `YYYY-MM-DD` day for `date`, `true` or `false` (not text) for `cleared`, `reconciled`, `transfer` and `parent`. A `set` with a truthy `options.template` or `options.formula` is not type checked. The same holds for `manage_rules`.

**Condition fields and operators.** All four rule write tools and `manage_rules` check one map, equal to what the installed Actual accepts (a unit test compares the two on every run):

| Field | Operators |
|-------|-----------|
| `imported_payee` | `is`, `isNot`, `contains`, `matches`, `doesNotContain`, `oneOf`, `notOneOf` |
| `payee_name` | as `imported_payee`, plus `hasTags`, `hasAnyTag` |
| `notes` | `is`, `isNot`, `contains`, `matches`, `doesNotContain`, `hasTags`, `hasAnyTag` |
| `payee`, `category`, `category_group` | `is`, `isNot`, `oneOf`, `notOneOf` |
| `account` | `is`, `isNot`, `oneOf`, `notOneOf`, `onBudget`, `offBudget` |
| `amount` | `is`, `isapprox`, `isbetween`, `gt`, `gte`, `lt`, `lte` |
| `date` | `is`, `isapprox`, `gt`, `gte`, `lt`, `lte` |
| `cleared`, `reconciled` | `is` |

Any other field is refused with the list of valid ones; `description` and `saved` are not condition fields, and `transfer` and `parent` are refused (#766): Actual's rule engine never sets them on the transaction a rule is evaluated against, so a rule on them is stored and never matches (use `run_query`, or `actual_query_run` on the legacy surface, to find such transactions). Two differences from Actual are deliberate: `saved` is left out (Actual gives it no operator), and `contains`, `matches` and `doesNotContain` are refused on the id fields, because a rule compares the stored id and such a rule would never fire. To match a payee by name, use `payee_name` or `imported_payee`.

| Tool | Description |
|------|-------------|
| `actual_rules_create_or_update` | Idempotent upsert: create a rule, or update the existing one that matches the same conditions, in a single call. Use this instead of get-then-create when re-running a categorisation setup, so repeated runs do not pile up duplicate rules |
| `actual_rules_create_batch` | Create 1 to 50 rules in one call, each exactly the input of `actual_rules_create`. Best-effort, not atomic (see Batch Operations): a rule that fails its own checks, names a category, payee or account that does not exist, or is rejected by Actual is reported with its index while the rest continue |

## Schedules

| Tool | Description |
|------|-------------|
| `actual_schedules_get` | List scheduled transactions, with their next occurrence date |
| `actual_schedules_dates` | List the dates one schedule falls on, computed by Actual (weekend moves, patterns and intervals included); optional `start`, `end` and `count`, at most 366 dates with a `truncated` flag |
| `actual_schedules_create` | Create a schedule (one-off or recurring); recurrence is a typed config, see `src/lib/schemas/recur.ts`; an `endMode` without its `endOccurrences` or `endDate`, an impossible `start` or `endDate`, and an `endDate` before `start` are refused before the write |
| `actual_schedules_update` | Update an existing schedule's amount, payee, account, or recurrence; the same recurrence refusals as create apply, and a refused update leaves the stored schedule unchanged |
| `actual_schedules_delete` | Delete a schedule and the rule that drives it |

## Advanced Query & Sync

| Tool | Description |
|------|-------------|
| `actual_query_run` | Execute custom ActualQL query |
| `actual_bank_sync` | Run bank sync (GoCardless/SimpleFIN) for one account or all linked open accounts; reports new, matched and updated counts with up to 100 ids each. A sync past the operation timeout reports "timed out" and may still have imported, so re-list before retrying; an all-accounts sync that fails on one account may still have imported the others, and those imports reach the Actual server with the next write in the session or when it closes. Refuses at once, with no provider call, for a local, closed, half-linked or unknown account, or when no open account is linked |

## Batch Operations

Four tools take many items in one call, for clients that allow only a few tool calls per turn. They share ONE contract: each item is applied independently and **not atomically**. There is no rollback, so items applied before a failure stay applied; a bad item is reported by its index and the rest continue; an infrastructure failure (lost connection, timeout) fails the whole call, and then you must read the data back before retrying anything. A bulk path never retries a create on its own.

- `actual_transactions_update_batch` (counted under Transactions): update up to 50 transactions, `{id, fields}` each. Result: `{ succeeded: [{id}], failed: [{id, error}], total, successCount, failureCount }`. Items marked "not attempted" were never sent. Re-read with `actual_transactions_get` before retrying any item. An unknown `account` in an item's fields fails that item (`Account "<id>" not found`), a closed account is accepted.
- `actual_transactions_import` (counted under Transactions): bulk create with import semantics (deduplication and reconciliation against existing transactions; rules are always applied). Use it to add many transactions at once. An unknown `accountId` is refused and nothing is imported; a closed account is accepted. A row accepts only `date`, `amount`, `payee`, `payee_name`, `imported_payee`, `category`, `notes`, `cleared`, `imported_id`, `account`, `subtransactions`, `transfer_id` and `reconciled`; any other key (a typo, or an internal column such as `tombstone`) refuses the whole call by name and nothing is written.
- `actual_budget_updates_batch`: set budget amounts and/or carryover flags for 1 to 100 month/category pairs, and the way to rebalance categories: read the month with `actual_budgets_get_month`, then send one batch of absolute amounts. Each operation needs at least one of `amount` (integer cents) or `carryover`. Result: `{ succeeded: [{index, month, categoryId}], failed: [{index, month, categoryId, error}], total, successCount, failureCount }`. An unknown category, an out-of-range month or a carryover on an income category, or an amount on an income category of an envelope budget, fails only that item; an amount is at most 2251799813685247. After a timeout, read the months back with `actual_budgets_get_month` before retrying.
- `actual_rules_create_batch` (counted under Rules): create 1 to 50 rules, each exactly the input of `actual_rules_create`. Result: `{ succeeded: [{index, id}], failed: [{index, error}], total, successCount, failureCount }`. Items marked "not attempted" were never sent. Re-read with `actual_rules_get` before retrying any item.

## Server Information & Lookup

| Tool | Description |
|------|-------------|
| `actual_server_info` | Server status, version, build info |
| `actual_server_get_version` | Actual Budget server version |
| `actual_get_context` | Retrieve open accounts, category groups with nested categories, and payees (name-sorted, capped by `payeeLimit`) in a single call |
| `actual_get_id_by_name` | Resolve an exact name → UUID for accounts, schedules, categories, payees. A name shared by several entities is refused with their ids (at most 10 listed, then a count) |
| `actual_entities_search` | Find accounts/categories/payees by a name pattern (contains/startsWith/endsWith/exact/fuzzy). Fixes "payee not found" from a partial or mistyped name |

## Session Management

| Tool | Description |
|------|-------------|
| `actual_session_list` | List your own active MCP sessions with their activity status; the pool totals cover every session. Stays available under `MCP_READ_ONLY=true` |
| `actual_session_close` | Close one of your own idle sessions (never the current one, partial id match) to free a slot after "Max concurrent sessions reached"; with no id it closes your oldest idle session |

These two manage the session pool itself, not budget data.

## Compact surface

Fifteen compact tools ship (#672 to #678). They are listed under `MCP_TOOL_SURFACE=compact` (the default) or `all`, carry no `actual_` prefix and no `outputSchema`. Under `MCP_READ_ONLY=true` the six read tools (`get_context`, `list_entities`, `search_transactions`, `summarize_transactions`, `list_budget_months` and `run_query`) stay published and the nine `manage_*` tools are hidden whole. Each call reaches one legacy tool and returns its result unchanged. The full 85-row mapping is in the [migration guide](../guides/migrating-to-compact-tools.md#legacy-tool-to-compact-call).

| Tool | Description |
|------|-------------|
| `get_context` | Budget structure or server details, chosen by `topic`: `structure` (default; accounts, categories with groups, payees; options `include_accounts`, `include_categories`, `include_payees`, `include_closed`, `payee_limit`), `server` (name, version, description, transport, runtime, dependencies, uptime, memory and tool counts), `version` or `preferences` (`{ preferences, keys, count, message }`) |
| `list_entities` | List, search or look up one entity `type` (account, account_group, category, category_group, payee, tag, rule, schedule, note, budget_file). Account, category and payee take `query` (with `match_type`, `limit`) or `name`; payee takes `sort: "frequency"` (the 10 most used payees of the last 12 weeks; a transfer payee can appear); a `query` result carries `total` (all matches) and `truncated` (true when more matched than `count` returned) (#755); rule takes `payee_id`; schedule takes `name` (refused with every candidate id when several rows share it) or `schedule_id` (with `start`, `end`, `count`; default and maximum 366); note requires `id`; budget_file takes `scope`. In the default `configured` scope, a row marked `locked` is encrypted, has no key on this server and cannot be switched to. |
| `search_transactions` | Find transaction records, chosen by `by`: `account`, `filter` (id-based, with `notes`, `cleared`, `reconciled`), `amount` (range or `absolute_amount`; needs an account or a date), `category`, `month`, `payee` (by name) or `uncategorized` (with `include_transactions`, `limit`, `offset`). A category or payee name shared by several entities matches all of them, and names are matched trimmed and case-insensitively (#802). A split is matched by its children when a category, a payee with a category, or notes is searched: the rows returned are the matching children, each with its own `id` and a `parent_id`, an amount filter then compares with the child amount, and a notes term found in the split's own notes matches every child, so each child that passes the other filters is returned (#750). An amount-only or payee-only search still matches the parent row. `category` and `payee` need their `category_name` or `payee_name`, and `filter`, `category` and `month` refuse an explicit off-budget `account_id` (their results exclude off-budget accounts; read one with `account`) (#756). `amount`, `category`, `month` and `payee` return `hasMore`, true when more rows matched than `limit` returned; `count` and `totalAmount` cover only the returned rows (#755). Read-only; a `null` field is treated as omitted |
| `summarize_transactions` | Totals, chosen by `report`: `by_category`, `by_payee`, `grouped` (requires `start_date`, `end_date`, `group_by`, one grouping or an array of up to 5), `account_flow` (requires `start_date`, `end_date`, `account_ids`), `recurring` (`start_date` or `months`) or `balance` (requires `account_id`, optional `cutoff`). `by_category`, `by_payee` and `balance` are signed (outflows negative); `grouped`, `account_flow` and `recurring` report outflows as positive amounts; `by_category` and `by_payee` include transfers. Read-only |
| `list_budget_months` | List every budget month as `YYYY-MM`, or pass `month` for one month's budget (category groups and categories; on an envelope budget `totalBudgeted` is the expense budgets summed with the sign reversed (a tracking budget has a plain positive sum)). No selector. Read-only; a `null` field is treated as omitted |
| `run_query` | Run one read-only SQL query over the budget data, for example `SELECT id, name FROM accounts`. `query` is required. Returns `{ result: { data, dependencies } }`; a bare table name returns only `{ id }`. Read-only |
| `manage_transactions` | Write transactions, chosen by `action`: `create` (requires `account`, `date`, `amount`; a transfer payee is refused, use `transfer`), `update` (requires `id` and one field to change; `null` clears `payee`, `imported_payee`, `category`, `notes`, `imported_id`, `cleared` and `reconciled` (to clear the payee pass `payee: null`; `payee_name` takes a name, never null), but `account`, `date` and `amount` cannot be null: omit them to leave them unchanged, and a null is refused by name before anything is written; `payee` is an id only, `payee_name` is matched or created), `update_batch` (`updates`, 1 to 50 `{id, fields}`, each `fields` with at least one key and no unknown key, else the whole call is refused; not atomic), `delete` (`id`), `import` (`account_id`, `txs`; a row with a key outside the documented set is refused by name and nothing is written), `merge` (`ids`, exactly two different ids) or `transfer` (`from_account`, `to_account`, positive `amount`, `date`). An unknown account is refused on `update` and `import` (on `update_batch` that item fails), a closed account is accepted. A `payee_name` shared by two or more payees is refused on `create` and `import` with the candidate ids (a transfer payee never counts) and nothing is written. An unknown `payee` or `category` id (also a split child's) is refused on `create`, `update` and `update_batch` (that item fails) and nothing is written. Amounts are integer cents. Destructive (delete, merge); hidden under `MCP_READ_ONLY` |
| `manage_accounts` | Write accounts and account groups, chosen by `action`: `create` (`entity` `account` or `account_group`, `name`; optional `balance` and `offbudget` for an account), `update` (`entity`, `id`, at least one field; an account takes `account_group_id`, a group id or null to ungroup), `close` (`id`, optional `transfer_account_id`, `transfer_category_id`; `entity` omitted or `account`), `reopen` (`id`), `delete` (`entity`, `id`; a closed account is not deleted: reopen it first), `bank_sync` (optional `account_id`; reaches the bank providers) or `set_note` (`id`, `note`; an unknown id is refused as not found). Amounts are integer cents. Destructive (delete, close); open-world (bank sync); hidden under `MCP_READ_ONLY` |
| `manage_categories` | Write categories and category groups, chosen by `action`: `create` (`entity` `category` or `category_group`, `name`; a category needs `group_id`; an unknown `group_id` on create or update is refused as not found, since it would leave a category no tool can reach; a category takes its group's `is_income`, a contradicting value is refused, and a move to a group of the other kind needs `is_income` too; `is_income` true on a category group makes an income group unless the budget already has one), `update` (`entity`, `id`, at least one field), `delete` (`entity`, `id`) or `set_note` (`id`, `note`; an unknown id is refused as not found). Destructive (delete); hidden under `MCP_READ_ONLY` |
| `manage_payees` | Write payees, chosen by `action`: `create` (`name`; `notes` is stored as the payee's note), `update` (`id`, at least one of `name` (refused on a transfer payee: rename its account), `category`; `null` clears the category; only the payee's own single-condition, default-stage rule is edited or deleted), `delete` (`id`), `merge` (`target_id`, `merge_ids`, 1 to 50) or `set_note` (`id`, `note`; an unknown id is refused as not found). Destructive (delete, merge); hidden under `MCP_READ_ONLY` |
| `manage_tags` | Write the tag list (a colour and description per tag; a transaction is tagged through its notes, see [Tags](#tags)), chosen by `action`: `create` (`tag`, one word with no `#` or whitespace; optional `color` as 6 digit hex such as `#33aa33`, `description`; an existing name returns its id and keeps the colour and description not supplied, a deleted name is revived with only the supplied fields), `update` (`id`, at least one of `tag`, `color`, `description`; a rename onto a name another tag has, live or deleted, is refused; a rename does not change notes) or `delete` (`id`, soft delete). Destructive (delete); hidden under `MCP_READ_ONLY` |
| `manage_rules` | Write rules, chosen by `action`: `create` (`conditions`, `actions`, each non-empty; optional `stage`, `conditions_op`), `create_batch` (`rules`, 1 to 50 with camelCase keys; not atomic), `upsert` (as create; a rule with the same conditions is updated), `update` (`id` and any of `stage`, `conditions_op`, `conditions`, `actions`; each action needs `op`) or `delete` (`id`). Destructive (delete); hidden under `MCP_READ_ONLY` |
| `manage_schedules` | Write schedules, chosen by `action`: `create` (`date`: YYYY-MM-DD or a recurrence object; optional `name`, `payee`, `account`, `amount`, `amount_op`, `posts_transaction`), `update` (`id` and any of those plus `reset_next_date`; null clears `payee` and `account`) or `delete` (`id`, also removes the schedule's rule). An unknown `account` or `payee` id is refused on create and update, and nothing is written. A recurrence `date` is refused before any write when `endMode` is `after_n_occurrences` without `endOccurrences`, when it is `on_date` without `endDate`, when `start` or `endDate` is not a real calendar day, or when `endDate` is before `start` (equal is accepted); `endDate` or `endOccurrences` with another `endMode` is not refused. Destructive (delete); hidden under `MCP_READ_ONLY` |
| `manage_budget_months` | Write budget month data, chosen by `action`: `set_amount` (`month`, `category_id`, `amount` at most 2251799813685247 either way; an income category is refused on an envelope budget), `set_amount_batch` (`operations`, 1 to 100; not atomic), `set_carryover` (`month`, `category_id`, `flag`: true rolls an overspent balance into the next month, false resets it; from that month on; expense categories only), `hold` (`month`, `amount` above 0; may hold less than asked), `reset_hold` (`month`), `transfer` (`month`, `from_category_id`, `to_category_id`, `amount` above 0 and at most 2251799813685247; expense categories only; not atomic) or `set_note` (`month`, `note`; "" clears). Not destructive; hidden under `MCP_READ_ONLY` |
| `manage_budget_files` | Switch, import or export budget files, chosen by `action`: `switch` (`budget_name`; takes effect now in this session, other open sessions keep theirs, remembered per caller so a new session of the same caller starts on it; holders of the one legacy bearer token are one caller), `import` (exactly one of `path` or `base64`; optional `type` (`actual`, `ynab4` or `ynab5`; default `actual`), `filename`; adds a new local copy and normally a new server budget file that nothing here removes; replaces nothing, and the session stays on its configured budget) or `export` (optional `filename`; writes a .zip into the server export directory, overwriting a same-named file). Marked destructive (the import cannot be undone from here); hidden under `MCP_READ_ONLY` |

### Migrating from the `actual_*` names (#680)

See the [migration guide](../guides/migrating-to-compact-tools.md): the full legacy-to-compact table, the `MCP_TOOL_SURFACE=legacy` escape hatch and how to re-select saved tool choices.
