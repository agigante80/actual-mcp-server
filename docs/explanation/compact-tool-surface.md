# Compact tool surface

**Status:** design record for #670, implemented by #671 to #682. #671 is implemented: the `MCP_TOOL_SURFACE` setting, the registry, the dispatcher and `callOperation`. #672 ships the first two compact tools, `get_context` and `list_entities`, plus routes (section 4d) and the section 4b rewrite of legacy names in error text. #673 ships `search_transactions` and `summarize_transactions`. The other 11 tools are still to come. The stale `listTool` in the adapter is still not corrected.

The compact surface is a second public tool list of 15 tools with no `actual_` prefix, named `verb_noun` in snake_case, each fronting a group of the 85 existing tools through one dispatcher. The implementation tickets (#671 to #678, #679, #680, #681) cite this page for the mapping, the schemas and the naming rules. The delivery plan is in `docs/plans/compact-tool-surface.md`.

## Contents

- [1. Decision record](#1-decision-record)
- [2. Naming rules](#2-naming-rules)
- [3. Schema shape](#3-schema-shape)
- [4. Dispatch contract](#4-dispatch-contract)
- [5. Update-shape normalisation](#5-update-shape-normalisation)
- [6. Settled design points](#6-settled-design-points)
- [7. Full mapping of the 85 tools](#7-full-mapping-of-the-85-tools)
- [8. Flat schemas of the 15 tools](#8-flat-schemas-of-the-15-tools)
- [9. Rollout](#9-rollout)

## 1. Decision record

This supersedes #654 (decide whether to publish a smaller default set: decided yes, a 15-tool compact surface, default flipped in #680) and the "keep, sharpen descriptions" conclusion of [../audit/tool-overlap.md](../audit/tool-overlap.md) (#653).

That conclusion rested on the rule that no tool mixes reads and writes. The compact surface keeps that rule (six read tools, nine `manage_*` tools, no tool mixes them) and breaks only the one-tool-per-operation granularity.

Why: at 85 tools Glama scores Tool Count 1 and Disambiguation 2, and no description edit moves a count. Its rubric gives Tool Count 5 only to "typically 3-15 tools" and Naming 5 only to a "consistent verb_noun pattern throughout".

Alternatives rejected:

- Toolset trimming only: it hides tools, but the 85 stay the default and the score page lists all of them.
- Fewer tools by deleting features: loses capability.
- A generic `call(operation, args)` tool: an unreadable schema, and the scorer cannot grade parameter semantics.

## 2. Naming rules

- No prefix; `verb_noun`, snake_case.
- Reads: `get_` for a single context object (`get_context`), `list_` for collections (`list_entities`, `list_budget_months`), `search_` for record lookups (`search_transactions`), `summarize_` for aggregates (`summarize_transactions`), `run_` for the query escape hatch (`run_query`).
- Writes: `manage_<noun>` with an `action` enum (`create`, `update`, `delete`, plus domain verbs). Batch actions carry the `_batch` suffix.
- Property names are the legacy names in snake_case.
- Selector names are `topic`, `type`, `by`, `report`, `action`, `entity`.

## 3. Schema shape

Settled. Each tool is a flat `z.object().strict()` with one required selector (`get_context` has an optional selector, `list_budget_months` and `run_query` have none; see section 8). Every other property is optional in the published JSON schema. Per-action required and valid fields are enforced by one `superRefine`, so a bad call is a ZodError formatted by `formatZodError` (#206). The published schema has no `oneOf`, `anyOf` or `discriminatedUnion`, because Gemini and OpenAI function schemas reject them; `tests/unit/schema_json_openai_compat.test.js` and `tests/unit/tool_schema_shape.test.js` guard this. A second opinion reached the same shape independently.

## 4. Dispatch contract

Settled. One compact call maps to exactly one legacy call. The compact layer calls a new tools-manager method `callOperation(legacyName, args)` (built in #671). It skips the publication check only as far as section 4a allows (`callToolChecked` refuses unpublished tools, and the legacy tools are registered but hidden under the compact surface), and it keeps the `MCP_READ_ONLY` check and the legacy Zod validation.

A compact tool never imports or calls the adapter and never opens an adapter session (the never-nest rule). Compact tools are plain tool definitions that return the legacy success value unchanged, with the name translation of section 4b applied to errors and refusals (`createTool` would wrap the value in `{ result }`). Compact tools are themselves dispatched through `callToolChecked`, so a compact ZodError is formatted by `formatZodError` there; `callOperation` does not log a second `[TOOL RESULT]` record for the same call.

### 4a. Publication bypass is narrow

`callOperation` skips only the hide that `MCP_TOOL_SURFACE` itself causes. A legacy tool hidden for `MCP_TOOLSETS` or `MCP_READ_ONLY` (the `hidden` map in `src/lib/toolsets.ts`, reasons from `unavailableError`) is still refused with `ToolUnavailableError` naming that setting.

Example: under `MCP_TOOL_SURFACE=all` with `MCP_TOOLSETS=context`, `manage_transactions` `{action: "delete", id}` is refused naming `MCP_TOOLSETS`, exactly as a direct `actual_transactions_delete` call is. #671 implements this contract.

### 4b. Legacy names in output

Errors pass through untouched as types: `NotFoundRefusal`, `OutOfRangeRefusal` and `isPreflightRefusal` keep working. The legacy tool name is baked into the refusal text when it is constructed (`notFoundMsg` in `src/lib/errors.ts`, called by the `NotFoundRefusal` constructor). Several legacy tools also catch a refusal and return it as a value (`transactions_create` returns `{success: false, error, id: null}`, `budgets_set_amount` returns `{success: false, error}`, `notes_update` returns `{error}`), so rewriting the `listTool` property alone changes nothing a client sees.

The dispatcher therefore rewrites names in text: in the message of any error a `callOperation` call throws, and in a returned top-level `error` string, every `actual_<name>` that appears in the section 7 table is replaced by its compact (tool, selector) phrase. For example `actual_accounts_list` becomes `list_entities with type account`. So `manage_transactions` `{action: "create"}` with an unknown account id returns an `error` text that names `list_entities with type account`, never `actual_accounts_list`.

The stale `listTool: 'actual_accounts_get'` in `src/lib/actual-adapter.ts` (the id-filter map, line 3015 at the time of writing) names a tool that is not registered. #671 corrects it to `actual_accounts_list` so the table can translate it.

A legacy ZodError path is mapped back to compact names: the dispatcher first strips the `fields` wrapper it added (section 5), then maps the first remaining segment through the rename table (`['fields', 'amount']` becomes `amount`, `['accountId']` becomes `account_id`).

Legacy names inside success result messages and field descriptions (for example the `budgets_import` success message and the `budgets_switch` description) are an accepted Phase A gap. Under `all` those tools are callable. Under `compact` a call to one fails with a refusal naming `MCP_TOOL_SURFACE` rather than silently; that needs `ToolUnavailableSetting` (`src/lib/errors.ts`, `'MCP_TOOLSETS' | 'MCP_READ_ONLY' | 'MCP_TOOL_SURFACE'` since #671). Rewriting them is a precondition of #680 (the default flip).

### 4c. Field types

Each compact property is at least as strict as the legacy validator for that field (`CommonSchemas` ids, `CommonSchemas.date` for dates including `cutoff`, integer cents for `amount`, `min_amount` and `max_amount`), so the compact schema never accepts what the legacy schema rejects. The legacy schema still validates after normalisation.

### 4d. Routes and parity counting (shipped by #672)

A row of a compact tool may carry `routes`: alternative legacy targets chosen by which keys the caller sent. Each route has `triggers` (the route is chosen when any of those keys is present), its own `fields` schema, and the same `rename`, `wrap`, `drop` and `fixed` options as a row. `drop` names compact keys that are consumed but not forwarded (for example `sort`, `scope`). `fixed` names legacy arguments the compact layer sets itself and that win over a caller key (for example `type: "accounts"` on `actual_entities_search`). A route may also carry `when(call)` for a trigger that only counts for some values (`scope: "server"`). The legacy name comes only from the static tables, never from caller input.

Two routes triggered together are refused as mutually exclusive, a trigger without a key its route requires is refused naming both ("query: required with limit"), and a key the chosen target does not declare is refused naming the types that accept it. All of these are `ZodError`s raised before any `callOperation`, and the flat published schema runs the same plan, so a client that validates locally sees the same refusal.

`get_context` routes (selector `topic`, default `structure`):

| topic | legacy tool |
|-------|-------------|
| structure | `actual_get_context` (options renamed to camelCase) |
| server | `actual_server_info` |
| version | `actual_server_get_version` |
| preferences | `actual_preferences_get` |

`list_entities` routes (selector `type`, required):

| type | default row | routes |
|------|-------------|--------|
| account, category | `actual_accounts_list`, `actual_categories_get` | `query`, `match_type`, `limit` to `actual_entities_search`; `name` to `actual_get_id_by_name` |
| payee | `actual_payees_get` | the two above, and `sort` to `actual_payees_common_list` |
| account_group, category_group, tag | `actual_account_groups_list`, `actual_category_groups_get`, `actual_tags_list` | none |
| rule | `actual_rules_get` | `payee_id` to `actual_payee_rules_get` |
| schedule | `actual_schedules_get` | `name` to `actual_get_id_by_name`; `schedule_id`, `start`, `end`, `count` to `actual_schedules_dates` |
| note | `actual_notes_get` (`id` required) | none |
| budget_file | `actual_budgets_list_available` | `scope: "server"` to `actual_budgets_get_all` |

Parity counting (`tests/unit/compact_mapping_parity.test.js`): a legacy tool is mapped when some row or route of a compact tool targets it, and it must belong to exactly one compact tool. Several rows or routes of the same tool may share a target, so `actual_entities_search` and `actual_get_id_by_name` are counted once, under `list_entities`, however many types route to them.

The 4b rewrite lives in `src/compact/dispatch.ts` (`legacyPhrases`, `rewriteError`, `rewriteResult`). A route's phrase names its first trigger, for example `list_entities with query`. An error is rewritten in place, so a `NotFoundRefusal` keeps its class and `isPreflightRefusal` still holds; its `listTool` property is not rewritten.

## 5. Update-shape normalisation

Found in code: the legacy update tools disagree. `accounts_update`, `categories_update`, `category_groups_update`, `payees_update`, `rules_update` and `transactions_update` take `{ id, fields: {...} }`. `account_groups_update`, `schedules_update` and `tags_update` are flat. The compact layer is flat everywhere, and the dispatcher wraps the non-id properties into `fields` where the legacy tool expects it.

`transactions_update_batch` is a separate case: each item of its `updates` array is `{ id, fields }`, and the batch `fields` object has nine keys (`account`, `date`, `amount`, `payee`, `payee_name`, `imported_payee`, `category`, `notes`, `cleared`), fewer than the thirteen of `transactions_update`. `imported_id`, `transfer_id`, `reconciled` and `subtransactions` are not accepted in a batch.

## 6. Settled design points

Each was decided with a code fact.

- **`notes_update`** accepts an account, category, category-group, payee id or `budget-YYYY-MM`, so a single owner would be wrong. It becomes action `set_note` on `manage_accounts`, `manage_categories` (category or group id), `manage_payees` and `manage_budget_months` (takes `month`, and the dispatcher builds the id). Reads use `list_entities` type `note`.
- **`budgets_get_all` and `budgets_list_available`** are not duplicates (budget files on the Actual server this session may use, versus pre-configured budgets switchable by name), so `list_entities` type `budget_file` has `scope: configured | server`.
- **`entities_search`** covers accounts, categories and payees only; `get_id_by_name` also covers schedules. Both fold into `list_entities` via `query` (search) and `name` (exact id lookup), mutually exclusive.
- **`schedules_dates`** is `list_entities` type `schedule` with `schedule_id` (plus `start`, `end`, `count`); `payees_common_list` is type `payee` with `sort: frequency`; `payee_rules_get` is type `rule` with `payee_id`.
- **Preferences** stay a separate `get_context` topic, not folded into `structure` (different source, different cost).
- **`accounts_get_balance`** takes `id` (not `accountId`); the compact field is `account_id`.
- **`budgets_get_month`** has `month` optional in its schema but required in practice; `list_budget_months` treats an absent `month` as the list call.
- **Batch caps** are the legacy caps (`transactions_update_batch` 50, `budget_updates_batch` 1 to 100, `rules_create_batch` 50), and `transactions_update_batch` stays non-atomic.
- **Session tools.** `session_list` and `session_close` are HTTP administration of the session pool, not budget operations, so they stay outside the compact surface (reachable under `legacy` and `all` in Phase A). When #682 removes `legacy` and `all`, they are dropped from the public surface on purpose: pooled sessions still leave through the idle timeout (`SESSION_IDLE_TIMEOUT_MINUTES`, `src/lib/ActualConnectionPool.ts`) and the `MAX_CONCURRENT_SESSIONS` and `MAX_SESSIONS_PER_PRINCIPAL` caps, and publishing them beside the 15 would cost Tool Count 5. If an operator needs them later, they return as an opt-in admin surface in a new ticket. #682's parity test keeps them in its out-of-scope list as removed operations.
- **Output schemas.** `accounts_list` and `accounts_get_balance` are the only legacy tools with an `outputSchema`. `list_entities` and `summarize_transactions` return several shapes, so they declare none, and their `structuredContent` for those two selectors is dropped (#642). Accepted: the text content is unchanged.
- **Annotations** are per tool: `readOnlyHint: true` only on the six read tools; `destructiveHint: true` on any tool with a delete, merge, close, import or bank_sync action, which is every `manage_*` tool except `manage_budget_months`. They remain hints; nothing in `src/` may branch on them, and the compact layer adds no authorization surface.
- **`MCP_READ_ONLY`.** No compact tool mixes reads and writes, so under read-only every `manage_*` tool is absent whole. The dispatcher still derives the per-action gate from `WRITE_CAPABLE` as defence in depth (per-action gating therefore reduces to per tool in practice).
- **`MCP_TOOLSETS` and `MCP_TOOLS`** validate against legacy names. Under `compact` they must be `all` and empty (a startup error naming #680) until #680 remaps toolsets and the chat preset; under `all` they apply to legacy names only.
- **Counting.** `scripts/tool-count.mjs` counts lines matching `^\s*'actual_` in `src/actualToolsManager.ts`, and `scripts/version-bump.js` regex-counts the same `^\s*'actual_` lines over that file for the `**Tool Count:**` markers. The compact registry therefore lives outside `src/actualToolsManager.ts` (`src/compact/registry.ts`), so those counts stay the legacy 85, and the compact surface reports 15. `tests/manual/tests/sanity.js` asserts `EXPECTED_TOOL_COUNT` (default 85), correct while the default is `legacy`; #680 and #681 set 15 for compact runs.

## 7. Full mapping of the 85 tools

85 legacy tools map to 15 compact tools. Each legacy tool appears exactly once. A unit test in #671 (`tests/unit/compact_mapping_parity.test.js`) keeps the table true.

| # | Legacy tool (`actual_` prefix omitted) | Compact tool |
| :-- | :-- | :-- |
| 1 | `get_context` | `get_context` |
| 2 | `server_info` | `get_context` |
| 3 | `server_get_version` | `get_context` |
| 4 | `preferences_get` | `get_context` |
| 5 | `accounts_list` | `list_entities` |
| 6 | `account_groups_list` | `list_entities` |
| 7 | `categories_get` | `list_entities` |
| 8 | `category_groups_get` | `list_entities` |
| 9 | `payees_get` | `list_entities` |
| 10 | `payees_common_list` | `list_entities` |
| 11 | `tags_list` | `list_entities` |
| 12 | `rules_get` | `list_entities` |
| 13 | `payee_rules_get` | `list_entities` |
| 14 | `schedules_get` | `list_entities` |
| 15 | `schedules_dates` | `list_entities` |
| 16 | `notes_get` | `list_entities` |
| 17 | `budgets_list_available` | `list_entities` |
| 18 | `budgets_get_all` | `list_entities` |
| 19 | `get_id_by_name` | `list_entities` |
| 20 | `entities_search` | `list_entities` |
| 21 | `transactions_get` | `search_transactions` |
| 22 | `transactions_filter` | `search_transactions` |
| 23 | `transactions_search_by_amount` | `search_transactions` |
| 24 | `transactions_search_by_category` | `search_transactions` |
| 25 | `transactions_search_by_month` | `search_transactions` |
| 26 | `transactions_search_by_payee` | `search_transactions` |
| 27 | `transactions_uncategorized` | `search_transactions` |
| 28 | `transactions_summary_by_category` | `summarize_transactions` |
| 29 | `transactions_summary_by_payee` | `summarize_transactions` |
| 30 | `transactions_aggregate` | `summarize_transactions` |
| 31 | `account_flow_summary` | `summarize_transactions` |
| 32 | `recurring_expenses_summary` | `summarize_transactions` |
| 33 | `accounts_get_balance` | `summarize_transactions` |
| 34 | `budgets_get_months` | `list_budget_months` |
| 35 | `budgets_get_month` | `list_budget_months` |
| 36 | `query_run` | `run_query` |
| 37 | `transactions_create` | `manage_transactions` |
| 38 | `transactions_update` | `manage_transactions` |
| 39 | `transactions_update_batch` | `manage_transactions` |
| 40 | `transactions_delete` | `manage_transactions` |
| 41 | `transactions_import` | `manage_transactions` |
| 42 | `transactions_merge` | `manage_transactions` |
| 43 | `transfers_create` | `manage_transactions` |
| 44 | `accounts_create` | `manage_accounts` |
| 45 | `accounts_update` | `manage_accounts` |
| 46 | `accounts_close` | `manage_accounts` |
| 47 | `accounts_reopen` | `manage_accounts` |
| 48 | `accounts_delete` | `manage_accounts` |
| 49 | `bank_sync` | `manage_accounts` |
| 50 | `account_groups_create` | `manage_accounts` |
| 51 | `account_groups_update` | `manage_accounts` |
| 52 | `account_groups_delete` | `manage_accounts` |
| 53 | `categories_create` | `manage_categories` |
| 54 | `categories_update` | `manage_categories` |
| 55 | `categories_delete` | `manage_categories` |
| 56 | `category_groups_create` | `manage_categories` |
| 57 | `category_groups_update` | `manage_categories` |
| 58 | `category_groups_delete` | `manage_categories` |
| 59 | `payees_create` | `manage_payees` |
| 60 | `payees_update` | `manage_payees` |
| 61 | `payees_delete` | `manage_payees` |
| 62 | `payees_merge` | `manage_payees` |
| 63 | `rules_create` | `manage_rules` |
| 64 | `rules_create_batch` | `manage_rules` |
| 65 | `rules_create_or_update` | `manage_rules` |
| 66 | `rules_update` | `manage_rules` |
| 67 | `rules_delete` | `manage_rules` |
| 68 | `schedules_create` | `manage_schedules` |
| 69 | `schedules_update` | `manage_schedules` |
| 70 | `schedules_delete` | `manage_schedules` |
| 71 | `tags_create` | `manage_tags` |
| 72 | `tags_update` | `manage_tags` |
| 73 | `tags_delete` | `manage_tags` |
| 74 | `budgets_set_amount` | `manage_budget_months` |
| 75 | `budget_updates_batch` | `manage_budget_months` |
| 76 | `budgets_set_carryover` | `manage_budget_months` |
| 77 | `budgets_hold_for_next_month` | `manage_budget_months` |
| 78 | `budgets_reset_hold` | `manage_budget_months` |
| 79 | `budgets_transfer` | `manage_budget_months` |
| 80 | `budgets_switch` | `manage_budget_files` |
| 81 | `budgets_import` | `manage_budget_files` |
| 82 | `budgets_export` | `manage_budget_files` |
| 83 | `notes_update` | manage_accounts / manage_categories / manage_payees / manage_budget_months (action `set_note`) |
| 84 | `session_list` | not in the compact surface (HTTP administration) |
| 85 | `session_close` | not in the compact surface (HTTP administration) |

## 8. Flat schemas of the 15 tools

Per compact tool, the fields per selector value. "Legacy tool" is without the `actual_` prefix; where a row names two legacy tools, the `entity` field (or the arguments present) picks one. Compact property names are the legacy names in snake_case, with the renames noted in the last column. In `manage_*` rows marked "wrapped into legacy `fields`", the optional fields are the keys of that legacy `fields` object. A field not listed for a row is refused by the per-action `superRefine`.

**`get_context`** (selector `topic`, optional, default `structure`)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `structure` | `get_context` | none | include_accounts, include_categories, include_payees, include_closed, payee_limit | legacy defaults kept (closed accounts excluded, 500 payees) |
| `server` | `server_info` | none | none |  |
| `version` | `server_get_version` | none | none | Actual server version, not the MCP server version |
| `preferences` | `preferences_get` | none | none | kept a separate topic: not folded into `structure` |

**`list_entities`** (selector `type`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `account` | `accounts_list` | none | query, match_type, limit, name | `query` (+`match_type`, `limit`) -> actual_entities_search with type accounts; `name` -> actual_get_id_by_name with type accounts; `query` and `name` are mutually exclusive |
| `account_group` | `account_groups_list` | none | none |  |
| `category` | `categories_get` | none | query, match_type, limit, name | same query/name routing as account (type categories) |
| `category_group` | `category_groups_get` | none | none |  |
| `payee` | `payees_get` | none | query, match_type, limit, name, sort | same routing (type payees); `sort: "frequency"` -> actual_payees_common_list (and then no other field is allowed) |
| `tag` | `tags_list` | none | none |  |
| `rule` | `rules_get` | none | payee_id | `payee_id` -> actual_payee_rules_get (legacy `payeeId`) |
| `schedule` | `schedules_get` | none | name, schedule_id, start, end, count | `name` -> actual_get_id_by_name with type schedules; `schedule_id` (+`start`, `end`, `count`) -> actual_schedules_dates |
| `note` | `notes_get` | id | none | id is an entity id or `budget-YYYY-MM` |
| `budget_file` | `budgets_list_available` | none | scope | `scope: "server"` -> actual_budgets_get_all; default `configured` -> actual_budgets_list_available (the two differ: configured budgets vs budget files on the Actual server this session may use) |

**`search_transactions`** (selector `by`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `account` | `transactions_get` | none | account_id, start_date, end_date |  |
| `filter` | `transactions_filter` | none | account_id, start_date, end_date, min_amount, max_amount, category_id, payee_id, notes, cleared, reconciled | id-based filter. The legacy tool also accepts `null` for each field; the compact tool does not (omit a field for "no limit"), which the legacy tool treats the same way and which keeps the published schema within the size budget |
| `amount` | `transactions_search_by_amount` | none | min_amount, max_amount, absolute_amount, start_date, end_date, account_id, category_name, limit |  |
| `category` | `transactions_search_by_category` | none | category_name, start_date, end_date, account_id, min_amount, max_amount, limit |  |
| `month` | `transactions_search_by_month` | none | month, account_id, category_name, payee_name, min_amount, max_amount, limit |  |
| `payee` | `transactions_search_by_payee` | none | payee_name, start_date, end_date, account_id, category_name, min_amount, max_amount, limit |  |
| `uncategorized` | `transactions_uncategorized` | none | start_date, end_date, account_id, include_transactions, limit, offset |  |

**`summarize_transactions`** (selector `report`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `by_category` | `transactions_summary_by_category` | none | start_date, end_date, account_id, include_income |  |
| `by_payee` | `transactions_summary_by_payee` | none | start_date, end_date, account_id, limit |  |
| `grouped` | `transactions_aggregate` | start_date, end_date, group_by | account_ids, category_ids, category_group_ids, payee_ids, include_income, exclude_transfers | `group_by` is one of month, category, category_group, payee, account, or an array of 1 to 5 of them |
| `account_flow` | `account_flow_summary` | start_date, end_date, account_ids | none | `end_date` is not before `start_date`, as for `grouped` |
| `recurring` | `recurring_expenses_summary` | none | start_date, end_date, months, account_ids, min_occurrences, include_inactive | `months` and `start_date` are mutually exclusive |
| `balance` | `accounts_get_balance` | account_id | cutoff | `account_id` maps to the legacy field `id` |

**`list_budget_months`** (no selector)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `(no selector)` | `budgets_get_months / budgets_get_month` | none | month | `month` (YYYY-MM) present -> actual_budgets_get_month; absent -> actual_budgets_get_months |

**`run_query`** (no selector)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `(no selector)` | `query_run` | query | none | read-only ActualQL, still validated by src/lib/query-validator.ts |

**`manage_transactions`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `transactions_create` | account, date, amount | payee, payee_name, notes, category, cleared, imported_id, subtransactions |  |
| `update` | `transactions_update` | id | account, date, amount, payee, payee_name, imported_payee, category, notes, imported_id, transfer_id, cleared, reconciled, subtransactions | non-id properties are wrapped into the legacy `fields` object; at least one is required; nullable fields keep their legacy null meaning (null clears the field) |
| `update_batch` | `transactions_update_batch` | updates | none | `updates` is the legacy array of {id, fields}, max 50, not atomic |
| `delete` | `transactions_delete` | id | none |  |
| `import` | `transactions_import` | account_id, txs | none | `account_id` maps to legacy `accountId` |
| `merge` | `transactions_merge` | ids | none |  |
| `transfer` | `transfers_create` | from_account, to_account, amount, date | notes |  |

**`manage_accounts`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `accounts_create / account_groups_create` | entity, name | balance (account), sort_order (account_group) | `entity` is `account` or `account_group` |
| `update` | `accounts_update / account_groups_update` | entity, id | name, offbudget, closed (account); name, sort_order (account_group) | account: non-id properties wrapped into legacy `fields`; account_group: legacy is flat |
| `close` | `accounts_close` | id | transfer_account_id, transfer_category_id | `entity` must be omitted or `account` |
| `reopen` | `accounts_reopen` | id | none |  |
| `delete` | `accounts_delete / account_groups_delete` | entity, id | none |  |
| `bank_sync` | `bank_sync` | none | account_id | omit `account_id` to sync every linked open account |
| `set_note` | `notes_update` | id, note | none | clears the note when `note` is "" |

**`manage_categories`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `categories_create / category_groups_create` | entity, name | group_id (category, required), is_income, hidden (category_group) | `entity` is `category` or `category_group` |
| `update` | `categories_update / category_groups_update` | entity, id | name, group_id (category), is_income, hidden | non-id properties wrapped into legacy `fields` |
| `delete` | `categories_delete / category_groups_delete` | entity, id | none |  |
| `set_note` | `notes_update` | id, note | none | id resolves to a category or category group itself, so `entity` must be omitted |

**`manage_payees`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `payees_create` | name | notes |  |
| `update` | `payees_update` | id | name, transfer_acct, category | wrapped into legacy `fields`; see #651 (inherited behaviour) |
| `delete` | `payees_delete` | id | none |  |
| `merge` | `payees_merge` | target_id, merge_ids | none | legacy `targetId`, `mergeIds` |
| `set_note` | `notes_update` | id, note | none |  |

**`manage_tags`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `tags_create` | tag | color, description |  |
| `update` | `tags_update` | id | tag, color, description | legacy is flat |
| `delete` | `tags_delete` | id | none |  |

**`manage_rules`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `rules_create` | conditions, actions | stage, conditions_op |  |
| `create_batch` | `rules_create_batch` | rules | none | legacy array, max 50 |
| `upsert` | `rules_create_or_update` | conditions, actions | stage, conditions_op |  |
| `update` | `rules_update` | id | stage, conditions_op, conditions, actions | wrapped into legacy `fields`; omitting `stage` leaves it unchanged |
| `delete` | `rules_delete` | id | none |  |

**`manage_schedules`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `create` | `schedules_create` | date | name, payee, account, amount, amount_op, posts_transaction | `date` is YYYY-MM-DD or the legacy RecurConfig object |
| `update` | `schedules_update` | id | name, payee, account, amount, amount_op, date, posts_transaction, reset_next_date | legacy is flat |
| `delete` | `schedules_delete` | id | none |  |

**`manage_budget_months`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `set_amount` | `budgets_set_amount` | month, category_id, amount | none |  |
| `set_amount_batch` | `budget_updates_batch` | operations | none | legacy array, 1 to 100 operations |
| `set_carryover` | `budgets_set_carryover` | month, category_id, flag | none |  |
| `hold` | `budgets_hold_for_next_month` | month, amount | none |  |
| `reset_hold` | `budgets_reset_hold` | month | none |  |
| `transfer` | `budgets_transfer` | month, from_category_id, to_category_id, amount | none |  |
| `set_note` | `notes_update` | month, note | none | the dispatcher builds the legacy id `budget-YYYY-MM` from `month` |

**`manage_budget_files`** (selector `action`, required)

| Value | Legacy tool (without `actual_`) | Required fields | Optional fields | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `switch` | `budgets_switch` | budget_name | none | legacy `budgetName` |
| `import` | `budgets_import` | none | path, base64, type, filename | legacy rules on path/base64 exclusivity apply unchanged |
| `export` | `budgets_export` | none | filename |  |

## 9. Rollout

Phase A (#671 to #679) ships the surface behind `MCP_TOOL_SURFACE=legacy|compact|all` (registered in `src/config.ts`, `.env.example` and `docs/reference/configuration.md`, checked by `npm run config-drift`), default `legacy`, non-breaking, minor bump. Phase B flips the default (#680), migrates the test suites (#681) and later removes the legacy surface (#682, which absorbs #657).
