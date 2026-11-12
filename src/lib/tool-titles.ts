/**
 * Human-readable tool titles for the whole tool surface (#641).
 *
 * The MCP spec (2025-06-18 onward) gives a tool an optional top-level `title`: the display
 * name a client shows instead of the programmatic `name`. Claude Desktop and similar clients
 * show it in their tool UIs, and Glama's Tool Definition Quality Score reads it as part of
 * "Purpose Clarity". Same single-source shape as `tool-annotations.ts`: one table, one lookup,
 * attached in `buildToolListEntries` so both transports publish it.
 *
 * Style, enforced by `tests/unit/tool_titles.test.js`: sentence case, 2 to 5 words, no
 * leading "Actual", unique, and the first word agrees with the tool's `readOnlyHint` (a
 * read-only tool starts with a read verb such as Get, List or Search; a tool that changes
 * anything does not). Titles are display metadata only: nothing in `src/` may branch on one.
 *
 * Adding a tool: add its title here. The unit test fails naming any registered tool without
 * one, and any key here that is no longer a registered tool.
 */

export const TOOL_TITLES: Readonly<Record<string, string>> = {
  actual_account_flow_summary: 'Explain account balance changes',
  actual_account_groups_create: 'Create account group',
  actual_account_groups_delete: 'Delete account group',
  actual_account_groups_list: 'List account groups',
  actual_account_groups_update: 'Update account group',
  actual_accounts_close: 'Close account',
  actual_accounts_create: 'Create account',
  actual_accounts_delete: 'Delete account',
  actual_accounts_get_balance: 'Get account balance',
  actual_accounts_list: 'List accounts',
  actual_accounts_reopen: 'Reopen account',
  actual_accounts_update: 'Update account',
  actual_bank_sync: 'Sync bank transactions',
  actual_budget_updates_batch: 'Update budgets in bulk',
  actual_budgets_export: 'Export budget file',
  actual_budgets_get_month: 'Get budget month',
  actual_budgets_get_months: 'List budget months',
  actual_budgets_get_all: 'List budget files',
  actual_budgets_hold_for_next_month: 'Hold budget for next month',
  actual_budgets_import: 'Import budget file',
  actual_budgets_list_available: 'List configured budgets',
  actual_budgets_reset_hold: 'Release budget hold',
  actual_budgets_set_amount: 'Set budgeted amount',
  actual_budgets_set_carryover: 'Set category carryover',
  actual_budgets_switch: 'Switch active budget',
  actual_budgets_transfer: 'Move budget between categories',
  actual_categories_create: 'Create category',
  actual_categories_delete: 'Delete category',
  actual_categories_get: 'List categories',
  actual_categories_update: 'Update category',
  actual_category_groups_create: 'Create category group',
  actual_category_groups_delete: 'Delete category group',
  actual_category_groups_get: 'List category groups',
  actual_category_groups_update: 'Update category group',
  actual_entities_search: 'Search entities by name',
  actual_get_context: 'Get budget context',
  actual_get_id_by_name: 'Resolve name to ID',
  actual_notes_get: 'Get note',
  actual_notes_update: 'Set note',
  actual_payee_rules_get: 'List payee rules',
  actual_payees_common_list: 'List common payees',
  actual_payees_create: 'Create payee',
  actual_payees_delete: 'Delete payee',
  actual_payees_get: 'List payees',
  actual_payees_merge: 'Merge payees',
  actual_payees_update: 'Update payee',
  actual_preferences_get: 'Get budget preferences',
  actual_query_run: 'Run SQL query',
  actual_recurring_expenses_summary: 'Detect recurring expenses',
  actual_rules_create: 'Create rule',
  actual_rules_create_batch: 'Create rules in bulk',
  actual_rules_create_or_update: 'Create or update rule',
  actual_rules_delete: 'Delete rule',
  actual_rules_get: 'List rules',
  actual_rules_update: 'Update rule',
  actual_schedules_create: 'Create schedule',
  actual_schedules_dates: 'List schedule dates',
  actual_schedules_delete: 'Delete schedule',
  actual_schedules_get: 'List schedules',
  actual_schedules_update: 'Update schedule',
  actual_server_get_version: 'Get server version',
  actual_server_info: 'Get server system info',
  actual_session_close: 'Close session',
  actual_session_list: 'List sessions',
  actual_tags_create: 'Create tag',
  actual_tags_delete: 'Delete tag',
  actual_tags_list: 'List tags',
  actual_tags_update: 'Update tag',
  actual_transactions_aggregate: 'Aggregate transactions',
  actual_transactions_create: 'Create transaction',
  actual_transactions_delete: 'Delete transaction',
  actual_transactions_filter: 'Filter transactions',
  actual_transactions_get: 'List transactions',
  actual_transactions_import: 'Import transactions',
  actual_transactions_merge: 'Merge transactions',
  actual_transactions_search_by_amount: 'Search transactions by amount',
  actual_transactions_search_by_category: 'Search transactions by category',
  actual_transactions_search_by_month: 'Search transactions by month',
  actual_transactions_search_by_payee: 'Search transactions by payee',
  actual_transactions_summary_by_category: 'Summarize spending by category',
  actual_transactions_summary_by_payee: 'Summarize spending by payee',
  actual_transactions_uncategorized: 'List uncategorized transactions',
  actual_transactions_update: 'Update transaction',
  actual_transactions_update_batch: 'Update transactions in bulk',
  actual_transfers_create: 'Create transfer',
};

/** The display title for a tool, or undefined when it has none (the builder then omits it). */
export function titleFor(name: string): string | undefined {
  return Object.hasOwn(TOOL_TITLES, name) ? TOOL_TITLES[name] : undefined;
}
