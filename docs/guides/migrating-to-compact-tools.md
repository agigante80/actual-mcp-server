# Migrating to the compact tools

Since #680 the server publishes 15 compact tools by default instead of the 85 `actual_*` tools. A client, prompt or saved tool selection that names an `actual_*` tool gets a refusal until it is changed (or until you set `MCP_TOOL_SURFACE=legacy`).

## What changed and why

The server used to publish 85 tools named `actual_<category>_<action>`; it now publishes 15, with no `actual_` prefix and `verb_noun` names such as `list_entities` and `manage_transactions`. The 85 operations are all still there: each is now one value of a selector field (`action` on the nine `manage_*` tools, and `type`, `topic`, `by` or `report` on the read tools) or a field-triggered route. The reason is the tool budget: chat clients and registries such as Glama score and cap the size of `tools/list`, and 85 tools was too many. Amounts are still integer cents and dates `YYYY-MM-DD`; only the names and the argument shapes moved. The design record is [explanation/compact-tool-surface.md](../explanation/compact-tool-surface.md).

## Legacy tool to compact call

One row per legacy tool. When several compact actions reach one legacy tool, the row lists all of them. The third column is what the compact layer does to your arguments before calling the legacy tool: a renamed key, keys it does not forward, keys it moves under a wrapper, and values it sets itself.

<!-- BEGIN GENERATED: tool-migration -->
<!-- Generated from dist/src/compact/registry.js by `npm run docs:gen`. Do not edit. -->
| Legacy tool | Compact call | What the compact layer changes |
|---|---|---|
| `actual_account_flow_summary` | `summarize_transactions` (`report: "account_flow"`) | `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_ids` is sent as `accountIds` |
| `actual_recurring_expenses_summary` | `summarize_transactions` (`report: "recurring"`) | `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_ids` is sent as `accountIds`; `min_occurrences` is sent as `minOccurrences`; `include_inactive` is sent as `includeInactive` |
| `actual_accounts_close` | `manage_accounts` (`action: "close"`) | `transfer_account_id` is sent as `transferAccountId`; `transfer_category_id` is sent as `transferCategoryId`; `entity` is not forwarded |
| `actual_accounts_create` | `manage_accounts` (`action: "create"`) | `entity` is not forwarded |
| `actual_accounts_delete` | `manage_accounts` (`action: "delete"`) | `entity` is not forwarded |
| `actual_accounts_get_balance` | `summarize_transactions` (`report: "balance"`) | `account_id` is sent as `id` |
| `actual_account_groups_list` | `list_entities` (`type: "account_group"`) | none |
| `actual_account_groups_create` | `manage_accounts` (`action: "create"`), when `entity` is set | `entity` is not forwarded |
| `actual_account_groups_update` | `manage_accounts` (`action: "update"`), when `entity` is set | `entity` is not forwarded |
| `actual_account_groups_delete` | `manage_accounts` (`action: "delete"`), when `entity` is set | `entity` is not forwarded |
| `actual_accounts_list` | `list_entities` (`type: "account"`) | none |
| `actual_accounts_reopen` | `manage_accounts` (`action: "reopen"`) | none |
| `actual_accounts_update` | `manage_accounts` (`action: "update"`) | `entity` is not forwarded; keys other than `id` are sent under `fields` |
| `actual_bank_sync` | `manage_accounts` (`action: "bank_sync"`) | `account_id` is sent as `accountId` |
| `actual_budgets_get_all` | `list_entities` (`type: "budget_file"`), when `scope` is set | `scope` is not forwarded |
| `actual_budgets_list_available` | `list_entities` (`type: "budget_file"`) | `scope` is not forwarded |
| `actual_budgets_switch` | `manage_budget_files` (`action: "switch"`) | `budget_name` is sent as `budgetName` |
| `actual_budgets_get_month` | `list_budget_months`, when `month` is set | none |
| `actual_budgets_get_months` | `list_budget_months` | none |
| `actual_budgets_hold_for_next_month` | `manage_budget_months` (`action: "hold"`) | none |
| `actual_budgets_reset_hold` | `manage_budget_months` (`action: "reset_hold"`) | none |
| `actual_budgets_set_amount` | `manage_budget_months` (`action: "set_amount"`) | `category_id` is sent as `categoryId` |
| `actual_budgets_set_carryover` | `manage_budget_months` (`action: "set_carryover"`) | `category_id` is sent as `categoryId` |
| `actual_budgets_transfer` | `manage_budget_months` (`action: "transfer"`) | `from_category_id` is sent as `fromCategoryId`; `to_category_id` is sent as `toCategoryId` |
| `actual_budget_updates_batch` | `manage_budget_months` (`action: "set_amount_batch"`) | none |
| `actual_categories_create` | `manage_categories` (`action: "create"`) | `entity` is not forwarded |
| `actual_categories_delete` | `manage_categories` (`action: "delete"`) | `entity` is not forwarded |
| `actual_categories_get` | `list_entities` (`type: "category"`) | none |
| `actual_categories_update` | `manage_categories` (`action: "update"`) | `entity` is not forwarded; keys other than `id` are sent under `fields` |
| `actual_category_groups_create` | `manage_categories` (`action: "create"`), when `entity` is set | `entity` is not forwarded |
| `actual_category_groups_delete` | `manage_categories` (`action: "delete"`), when `entity` is set | `entity` is not forwarded |
| `actual_category_groups_get` | `list_entities` (`type: "category_group"`) | none |
| `actual_category_groups_update` | `manage_categories` (`action: "update"`), when `entity` is set | `entity` is not forwarded; keys other than `id` are sent under `fields` |
| `actual_payees_common_list` | `list_entities` (`type: "payee"`), when `sort` is set | `sort` is not forwarded |
| `actual_payees_create` | `manage_payees` (`action: "create"`) | none |
| `actual_payees_delete` | `manage_payees` (`action: "delete"`) | none |
| `actual_payees_get` | `list_entities` (`type: "payee"`) | none |
| `actual_payees_merge` | `manage_payees` (`action: "merge"`) | `target_id` is sent as `targetId`; `merge_ids` is sent as `mergeIds` |
| `actual_payees_update` | `manage_payees` (`action: "update"`) | keys other than `id` are sent under `fields` |
| `actual_payee_rules_get` | `list_entities` (`type: "rule"`), when `payee_id` is set | `payee_id` is sent as `payeeId` |
| `actual_query_run` | `run_query` | none |
| `actual_rules_create` | `manage_rules` (`action: "create"`) | `conditions_op` is sent as `conditionsOp` |
| `actual_rules_create_batch` | `manage_rules` (`action: "create_batch"`) | none |
| `actual_rules_create_or_update` | `manage_rules` (`action: "upsert"`) | `conditions_op` is sent as `conditionsOp` |
| `actual_rules_delete` | `manage_rules` (`action: "delete"`) | none |
| `actual_rules_get` | `list_entities` (`type: "rule"`) | none |
| `actual_rules_update` | `manage_rules` (`action: "update"`) | `conditions_op` is sent as `conditionsOp`; keys other than `id` are sent under `fields` |
| `actual_schedules_create` | `manage_schedules` (`action: "create"`) | `amount_op` is sent as `amountOp` |
| `actual_schedules_dates` | `list_entities` (`type: "schedule"`), when `schedule_id` or `start` or `end` or `count` is set | none |
| `actual_schedules_delete` | `manage_schedules` (`action: "delete"`) | none |
| `actual_schedules_get` | `list_entities` (`type: "schedule"`) | none |
| `actual_schedules_update` | `manage_schedules` (`action: "update"`) | `amount_op` is sent as `amountOp`; `reset_next_date` is sent as `resetNextDate` |
| `actual_transactions_aggregate` | `summarize_transactions` (`report: "grouped"`) | `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `group_by` is sent as `groupBy`; `account_ids` is sent as `accountIds`; `category_ids` is sent as `categoryIds`; `category_group_ids` is sent as `categoryGroupIds`; `payee_ids` is sent as `payeeIds`; `include_income` is sent as `includeIncome`; `exclude_transfers` is sent as `excludeTransfers` |
| `actual_transactions_create` | `manage_transactions` (`action: "create"`) | none |
| `actual_transactions_delete` | `manage_transactions` (`action: "delete"`) | none |
| `actual_transactions_merge` | `manage_transactions` (`action: "merge"`) | none |
| `actual_transactions_filter` | `search_transactions` (`by: "filter"`) | `account_id` is sent as `accountId`; `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `min_amount` is sent as `minAmount`; `max_amount` is sent as `maxAmount`; `category_id` is sent as `categoryId`; `payee_id` is sent as `payeeId` |
| `actual_transactions_get` | `search_transactions` (`by: "account"`) | `account_id` is sent as `accountId`; `start_date` is sent as `startDate`; `end_date` is sent as `endDate` |
| `actual_transactions_import` | `manage_transactions` (`action: "import"`) | `account_id` is sent as `accountId` |
| `actual_transactions_search_by_amount` | `search_transactions` (`by: "amount"`) | `min_amount` is sent as `minAmount`; `max_amount` is sent as `maxAmount`; `absolute_amount` is sent as `absoluteAmount`; `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_id` is sent as `accountId`; `category_name` is sent as `categoryName` |
| `actual_transactions_search_by_category` | `search_transactions` (`by: "category"`) | `category_name` is sent as `categoryName`; `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_id` is sent as `accountId`; `min_amount` is sent as `minAmount`; `max_amount` is sent as `maxAmount` |
| `actual_transactions_search_by_month` | `search_transactions` (`by: "month"`) | `account_id` is sent as `accountId`; `category_name` is sent as `categoryName`; `payee_name` is sent as `payeeName`; `min_amount` is sent as `minAmount`; `max_amount` is sent as `maxAmount` |
| `actual_transactions_search_by_payee` | `search_transactions` (`by: "payee"`) | `payee_name` is sent as `payeeName`; `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_id` is sent as `accountId`; `category_name` is sent as `categoryName`; `min_amount` is sent as `minAmount`; `max_amount` is sent as `maxAmount` |
| `actual_transactions_summary_by_category` | `summarize_transactions` (`report: "by_category"`) | `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_id` is sent as `accountId`; `include_income` is sent as `includeIncome` |
| `actual_transactions_summary_by_payee` | `summarize_transactions` (`report: "by_payee"`) | `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_id` is sent as `accountId` |
| `actual_transactions_uncategorized` | `search_transactions` (`by: "uncategorized"`) | `start_date` is sent as `startDate`; `end_date` is sent as `endDate`; `account_id` is sent as `accountId`; `include_transactions` is sent as `includeTransactions` |
| `actual_transactions_update` | `manage_transactions` (`action: "update"`) | keys other than `id` are sent under `fields` |
| `actual_transactions_update_batch` | `manage_transactions` (`action: "update_batch"`) | none |
| `actual_transfers_create` | `manage_transactions` (`action: "transfer"`) | none |
| `actual_server_info` | `get_context` (`topic: "server"`) | none |
| `actual_session_close` | not in the compact surface; legacy only | none |
| `actual_session_list` | not in the compact surface; legacy only | none |
| `actual_get_id_by_name` | `list_entities` (`type: "account"`), when `name` is set<br>`list_entities` (`type: "category"`), when `name` is set<br>`list_entities` (`type: "payee"`), when `name` is set<br>`list_entities` (`type: "schedule"`), when `name` is set | sets `type: "accounts"`<br>sets `type: "categories"`<br>sets `type: "payees"`<br>sets `type: "schedules"` |
| `actual_entities_search` | `list_entities` (`type: "account"`), when `query` or `match_type` or `limit` is set<br>`list_entities` (`type: "category"`), when `query` or `match_type` or `limit` is set<br>`list_entities` (`type: "payee"`), when `query` or `match_type` or `limit` is set | `match_type` is sent as `matchType`; sets `type: "accounts"`<br>`match_type` is sent as `matchType`; sets `type: "categories"`<br>`match_type` is sent as `matchType`; sets `type: "payees"` |
| `actual_server_get_version` | `get_context` (`topic: "version"`) | none |
| `actual_tags_list` | `list_entities` (`type: "tag"`) | none |
| `actual_tags_create` | `manage_tags` (`action: "create"`) | none |
| `actual_tags_update` | `manage_tags` (`action: "update"`) | none |
| `actual_tags_delete` | `manage_tags` (`action: "delete"`) | none |
| `actual_notes_get` | `list_entities` (`type: "note"`) | none |
| `actual_notes_update` | `manage_accounts` (`action: "set_note"`)<br>`manage_categories` (`action: "set_note"`)<br>`manage_payees` (`action: "set_note"`)<br>`manage_budget_months` (`action: "set_note"`) | none<br>none<br>none<br>`month` becomes `id: "budget-<month>"`, so `month: "2026-11"` is sent as `id: "budget-2026-11"` |
| `actual_budgets_export` | `manage_budget_files` (`action: "export"`) | none |
| `actual_budgets_import` | `manage_budget_files` (`action: "import"`) | none |
| `actual_preferences_get` | `get_context` (`topic: "preferences"`) | none |
| `actual_get_context` | `get_context` (`topic: "structure"`) | `include_accounts` is sent as `includeAccounts`; `include_categories` is sent as `includeCategories`; `include_payees` is sent as `includePayees`; `include_closed` is sent as `includeClosed`; `payee_limit` is sent as `payeeLimit` |
<!-- END GENERATED: tool-migration -->

## The escape hatch: `MCP_TOOL_SURFACE=legacy`

Setting `MCP_TOOL_SURFACE=legacy` brings back the 85 `actual_*` names unchanged. `all` publishes both lists and exists for test stacks only. Both values are temporary: #682 removes `legacy` and `all` together with the two session tools, and #682 must update this guide. Treat the escape hatch as time to migrate, not as a place to stay.

What it costs: the 85-tool `tools/list` (the problem the compact surface fixes: Glama's tool-count scoring and the tool budget of chat clients such as Gemini and LibreChat), and the five prompts (#661 to #665) are hidden, because they name compact tools. The two session tools (`actual_session_list`, `actual_session_close`) exist only under `legacy` or `all`.

The reverse trap: under the default surface a legacy name in `MCP_TOOLS` stops startup. The error names the tool and says to use a compact name or set `MCP_TOOL_SURFACE=legacy`. For example `MCP_TOOLS=actual_accounts_list` fails at start; `MCP_TOOLS=list_entities` works.

How to set it, by deployment style:

```bash
# Env file (.env, or the environment of a systemd unit or shell)
MCP_TOOL_SURFACE=legacy
```

```bash
# Docker: add it to the docker run command
docker run -d --env-file .env -e MCP_TOOL_SURFACE=legacy -p 3600:3600 agigante80/actual-mcp-server:latest
```

```yaml
# Compose: under the service
services:
  actual-mcp-server:
    environment:
      MCP_TOOL_SURFACE: legacy
```

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["actual-mcp-server@latest", "--stdio"],
      "env": {
        "MCP_TOOL_SURFACE": "legacy"
      }
    }
  }
}
```

Restart the server after the change: configuration is read once at startup. In Claude Desktop, restart the app.

## Re-selecting saved choices in chat clients

Anything a client stored by tool name now points at a tool that is no longer published. Re-select it against the new names:

- **LibreChat**: open each agent, remove the old `actual_*` entries from its tool list and select the compact tools. An agent keeps the old names and fails with "Tool not found" until you do. The [LibreChat page](clients/librechat.md) has the setup.
- **Claude Desktop**: the "always allow" choice is stored per tool name, so you are asked again for each compact tool. Approve the ones you use. Restart the app after changing the server.
- **Claude Code**: permission rules such as `mcp__actual-budget__actual_accounts_list` in `settings.json` or `settings.local.json` no longer match. Replace them with the compact names (`mcp__actual-budget__list_entities`) or the server wildcard (`mcp__actual-budget`).
- **Saved prompts, skills and scripts** that name `actual_*` tools: change each to the compact call from the table above. A model that has the old name in its instructions will keep trying it.
- **`MCP_TOOLS`**: list compact names (see above), or startup stops.
- **`MCP_TOOLSETS`**: the toolset names and the `chat` preset keep working. A toolset selects operations, and a compact tool is published when at least one operation behind it is selected; a call to an operation the toolsets leave out is refused naming `MCP_TOOLSETS`. For example `chat` publishes `get_context`, `run_query`, `manage_transactions`, `manage_budget_months`, `manage_rules` and `list_budget_months`.

## Before and after

Three requests, one for each kind of translation the compact layer does.

**A fixed value: find an account id by name.** The legacy lookup took the plural entity type (`accounts`). The compact tool takes the singular `type` (`account`; plain `list_entities` with only `type: "account"` replaces `actual_accounts_list`), and the layer sets the legacy plural itself, so you never send it.

```json
{ "tool": "actual_get_id_by_name", "arguments": { "type": "accounts", "name": "Checking" } }
```

becomes

```json
{ "tool": "list_entities", "arguments": { "type": "account", "name": "Checking" } }
```

**A route: read one month.** `list_budget_months` lists months by default. Sending `month` is the trigger that routes the call to the single-month operation.

```json
{ "tool": "actual_budgets_get_month", "arguments": { "month": "2026-11" } }
```

becomes

```json
{ "tool": "list_budget_months", "arguments": { "month": "2026-11" } }
```

**A build hook: set a month note.** The legacy tool identified the note by an id (`budget-<month>`); the compact tool takes the month and builds the id.

```json
{ "tool": "actual_notes_update", "arguments": { "id": "budget-2026-11", "note": "Holiday travel in this month" } }
```

becomes

```json
{ "tool": "manage_budget_months", "arguments": { "action": "set_note", "month": "2026-11", "note": "Holiday travel in this month" } }
```

The same `set_note` action exists on `manage_accounts`, `manage_categories` and `manage_payees`, where it takes the entity `id` directly.
