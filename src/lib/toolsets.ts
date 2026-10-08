/**
 * Server-side toolsets, presets and read-only mode (#483).
 *
 * An operator chooses which tools this PROCESS publishes, so a chat client with a small
 * context window or a strict turn limit sees a focused set instead of the whole registry.
 * The idea and the first implementation are @andycarlberg's (PR #520); the design is
 * modelled on GitHub's MCP server (GITHUB_TOOLSETS, GITHUB_TOOLS, GITHUB_READ_ONLY).
 *
 *   MCP_TOOLSETS   comma list of toolsets and presets. Default `all` (today's behaviour).
 *   MCP_TOOLS      extra individual tools published on top of MCP_TOOLSETS.
 *   MCP_READ_ONLY  drops every write-capable tool, overriding the two above.
 *
 * Design rules, each the answer to a way this can go wrong:
 *   - ONE source. resolvePublishedToolNames is pure and runs once, in
 *     actualToolsManager.initialize(), from the validated config. It returns an immutable
 *     policy (the published set plus a per-tool hide reason). Nothing reads process.env
 *     at dispatch time.
 *   - Hide AND refuse. Omitting a tool from tools/list is not access control, so callTool
 *     refuses an unpublished tool with ToolUnavailableError.
 *   - Fail loud. An unknown toolset, preset or tool name throws, and so does a
 *     configuration that resolves to zero tools. Never silently publish none or all.
 *   - READ-ONLY NEVER READS ANNOTATIONS. Annotations are hints (AGENTS.md). Write
 *     capability is the hard-coded WRITE_CAPABLE set below, guarded by
 *     tests/unit/toolsets.test.js against the adapter call graph. It is not derived at
 *     runtime because the Docker image ships dist/ only, with no src/ to scan.
 *   - Static per process. No tools/list_changed: a changing list invalidates the
 *     provider's prompt cache and client support for the notification is patchy.
 */

import { ToolUnavailableError, type ToolUnavailableSetting } from './errors.js';

/** Every registered tool belongs to exactly ONE of these (guarded by the unit test). */
export const TOOLSETS = {
  context: [
    'actual_get_context',
    'actual_accounts_list',
    'actual_categories_get',
    'actual_category_groups_get',
    'actual_payees_get',
    'actual_get_id_by_name',
    'actual_entities_search',
    'actual_server_info',
    'actual_server_get_version',
    'actual_tags_list',
    'actual_account_groups_list',
    'actual_budgets_list_available',
    'actual_budgets_get_all',
    'actual_preferences_get',
  ],
  transactions: [
    'actual_transactions_get',
    'actual_transactions_filter',
    'actual_transactions_search_by_amount',
    'actual_transactions_search_by_category',
    'actual_transactions_search_by_month',
    'actual_transactions_search_by_payee',
    'actual_transactions_uncategorized',
    'actual_transactions_create',
    'actual_transactions_update',
    'actual_transactions_update_batch',
    'actual_transactions_delete',
    'actual_transactions_import',
    'actual_transfers_create',
  ],
  analysis: [
    'actual_account_flow_summary',
    'actual_recurring_expenses_summary',
    'actual_transactions_summary_by_category',
    'actual_transactions_summary_by_payee',
    'actual_transactions_aggregate',
    'actual_accounts_get_balance',
    'actual_payees_common_list',
  ],
  budget: [
    'actual_budgets_getMonth',
    'actual_budgets_getMonths',
    'actual_budgets_setAmount',
    'actual_budgets_setCarryover',
    'actual_budgets_holdForNextMonth',
    'actual_budgets_resetHold',
    'actual_budgets_transfer',
    'actual_budget_updates_batch',
    'actual_notes_get',
    'actual_notes_update',
  ],
  rules: [
    'actual_rules_get',
    'actual_payee_rules_get',
    'actual_rules_create',
    'actual_rules_create_batch',
    'actual_rules_update',
    'actual_rules_create_or_update',
    'actual_rules_delete',
  ],
  schedules: [
    'actual_schedules_get',
    'actual_schedules_create',
    'actual_schedules_update',
    'actual_schedules_delete',
  ],
  structure: [
    'actual_accounts_create',
    'actual_accounts_update',
    'actual_accounts_delete',
    'actual_account_groups_create',
    'actual_account_groups_update',
    'actual_account_groups_delete',
    'actual_categories_create',
    'actual_categories_update',
    'actual_categories_delete',
    'actual_category_groups_create',
    'actual_category_groups_update',
    'actual_category_groups_delete',
    'actual_payees_create',
    'actual_payees_update',
    'actual_payees_delete',
    'actual_tags_create',
    'actual_tags_update',
    'actual_tags_delete',
    'actual_accounts_close',
    'actual_accounts_reopen',
    'actual_payees_merge',
  ],
  query: ['actual_query_run'],
  admin: [
    'actual_budgets_switch',
    'actual_budgets_import',
    'actual_budgets_export',
    'actual_bank_sync',
    'actual_session_list',
    'actual_session_close',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ToolsetName = keyof typeof TOOLSETS;
export const TOOLSET_NAMES = Object.keys(TOOLSETS) as ToolsetName[];

/**
 * A PRESET is a named tool list that cuts across the groups, accepted anywhere a toolset
 * name is. Presets are exempt from the one-group-per-tool rule.
 *
 * `chat` is seeded from a real day-to-day chat-assistant flow (#477): bootstrap, one read
 * path, the batch writes, and the few single writes a chat assistant needs. It is 12 tools
 * where the full surface is 83, roughly a 76% cut in tools/list bytes.
 *
 * actual_budgets_getMonth is in it on purpose (decision recorded on #483): budget_updates_batch
 * and budgets_setAmount tell the model to read a month back with it, and query_run has no
 * budget-month table to stand in. actual_budgets_getMonths is NOT in it: the out-of-range
 * refusal from setAmount and the batch already states the budget's first and last month.
 * tests/unit/toolsets.test.js scans every member's description and input schema for
 * references to tools the preset hides, and each such reference must name a published
 * substitute there, so a preset cannot quietly point the model at a tool it cannot call.
 */
export const PRESETS = {
  chat: [
    'actual_get_context',
    'actual_query_run',
    'actual_transactions_update_batch',
    'actual_budget_updates_batch',
    'actual_rules_create_batch',
    'actual_transactions_create',
    'actual_transactions_update',
    'actual_transactions_delete',
    'actual_rules_create',
    'actual_budgets_transfer',
    'actual_budgets_setAmount',
    'actual_budgets_getMonth',
  ],
} as const satisfies Record<string, readonly string[]>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

/**
 * Every tool that can change a budget or server state, for MCP_READ_ONLY.
 *
 * Derived by hand from the adapter call graph: the 43 tools whose adapter path reaches
 * queueWriteOperation, plus the four that mutate WITHOUT the write queue (bank_sync imports
 * transactions through the read path, budgets_export writes a zip to ACTUAL_EXPORT_DIR,
 * budgets_switch changes the active budget, session_close closes a pooled connection).
 * Never derive this from tool annotations.
 *
 * tests/unit/toolsets.test.js re-derives it from src/ and fails, naming the tool, when a
 * new writer is missing here. Add a new write tool to this set in the same commit.
 */
export const WRITE_CAPABLE: ReadonlySet<string> = new Set([
  'actual_account_groups_create',
  'actual_account_groups_delete',
  'actual_account_groups_update',
  'actual_accounts_close',
  'actual_accounts_create',
  'actual_accounts_delete',
  'actual_accounts_reopen',
  'actual_accounts_update',
  'actual_bank_sync',
  'actual_budget_updates_batch',
  'actual_budgets_export',
  'actual_budgets_holdForNextMonth',
  'actual_budgets_import',
  'actual_budgets_resetHold',
  'actual_budgets_setAmount',
  'actual_budgets_setCarryover',
  'actual_budgets_switch',
  'actual_budgets_transfer',
  'actual_categories_create',
  'actual_categories_delete',
  'actual_categories_update',
  'actual_category_groups_create',
  'actual_category_groups_delete',
  'actual_category_groups_update',
  'actual_notes_update',
  'actual_payees_create',
  'actual_payees_delete',
  'actual_payees_merge',
  'actual_payees_update',
  'actual_rules_create',
  'actual_rules_create_batch',
  'actual_rules_create_or_update',
  'actual_rules_delete',
  'actual_rules_update',
  'actual_schedules_create',
  'actual_schedules_delete',
  'actual_schedules_update',
  'actual_session_close',
  'actual_tags_create',
  'actual_tags_delete',
  'actual_tags_update',
  'actual_transactions_create',
  'actual_transactions_delete',
  'actual_transactions_import',
  'actual_transactions_update',
  'actual_transactions_update_batch',
  'actual_transfers_create',
]);

/** The raw settings, as validated by configSchema (src/config.ts). */
export interface ToolsetSettings {
  /** MCP_TOOLSETS: comma list of toolsets and presets. Empty means `all`. */
  toolsets: string;
  /** MCP_TOOLS: comma list of extra tool names. */
  tools: string;
  /** MCP_READ_ONLY, already parsed by configSchema. */
  readOnly: boolean;
}

/** The resolved, immutable publication policy for one process. */
export interface PublishedPolicy {
  /** Published tool names, in registry order. */
  readonly published: readonly string[];
  /** Registered names that are NOT published, mapped to the setting that hides them. */
  readonly hidden: ReadonlyMap<string, ToolUnavailableSetting>;
  /** Count of registered tools. */
  readonly registered: number;
  /** The resolved settings, for server_info and the startup log. */
  readonly settings: {
    readonly toolsets: readonly string[];
    readonly tools: readonly string[];
    readonly readOnly: boolean;
  };
}

const splitList = (raw: string): string[] =>
  raw.split(',').map((t) => t.trim()).filter(Boolean);

/**
 * Resolve the publication policy. Pure: same inputs, same policy, no environment reads.
 * Throws (a startup failure) on an unknown toolset, preset or tool name, on a group or
 * preset naming an unregistered tool, and on a configuration that publishes nothing.
 */
export function resolvePublishedToolNames(
  registeredNames: readonly string[],
  settings: ToolsetSettings,
): PublishedPolicy {
  const registered = new Set(registeredNames);

  // A table naming a tool the registry lacks would advertise something that cannot run.
  for (const [kind, table] of [['Toolset', TOOLSETS], ['Preset', PRESETS]] as const) {
    for (const [name, members] of Object.entries(table) as [string, readonly string[]][]) {
      const missing = members.filter((m) => !registered.has(m));
      if (missing.length > 0) {
        throw new Error(`${kind} "${name}" names tools that are not registered: ${missing.join(', ')}`);
      }
    }
  }

  const validToolsets = ['all', ...TOOLSET_NAMES, ...PRESET_NAMES];
  const toolsetTokens = splitList(settings.toolsets);
  if (settings.toolsets.trim() !== '' && toolsetTokens.length === 0) {
    throw new Error(`MCP_TOOLSETS="${settings.toolsets}" names no toolset. Valid names: ${validToolsets.join(', ')}`);
  }
  const requested = toolsetTokens.length > 0 ? toolsetTokens : ['all'];
  const unknownToolsets = requested.filter((t) => !validToolsets.includes(t));
  if (unknownToolsets.length > 0) {
    throw new Error(
      `Unknown name in MCP_TOOLSETS: ${unknownToolsets.map((t) => `"${t}"`).join(', ')}. ` +
        `Valid names: ${validToolsets.join(', ')}`,
    );
  }

  const extras = splitList(settings.tools);
  const unknownTools = extras.filter((t) => !registered.has(t));
  if (unknownTools.length > 0) {
    throw new Error(
      `Unknown tool in MCP_TOOLS: ${unknownTools.map((t) => `"${t}"`).join(', ')}. ` +
        `Use the full registered name, for example actual_accounts_list. Registered tools: ${[...registered].sort().join(', ')}`,
    );
  }

  const selected = new Set<string>();
  if (requested.includes('all')) {
    registeredNames.forEach((n) => selected.add(n));
  } else {
    for (const token of requested) {
      const members: readonly string[] = token in TOOLSETS ? TOOLSETS[token as ToolsetName] : PRESETS[token as PresetName];
      members.forEach((n) => selected.add(n));
    }
  }
  extras.forEach((n) => selected.add(n));

  const published: string[] = [];
  const hidden = new Map<string, ToolUnavailableSetting>();
  for (const name of registeredNames) {
    if (!selected.has(name)) hidden.set(name, 'MCP_TOOLSETS');
    else if (settings.readOnly && WRITE_CAPABLE.has(name)) hidden.set(name, 'MCP_READ_ONLY');
    else published.push(name);
  }

  if (published.length === 0) {
    throw new Error(
      `No tools would be published: MCP_TOOLSETS="${settings.toolsets}", MCP_TOOLS="${settings.tools}" and ` +
        `MCP_READ_ONLY=${settings.readOnly} resolve to 0 tools. For example, a toolset made only of writers ` +
        `(structure) publishes nothing under MCP_READ_ONLY=true.`,
    );
  }

  return Object.freeze({
    published: Object.freeze(published),
    hidden,
    registered: registeredNames.length,
    settings: Object.freeze({
      toolsets: Object.freeze(requested),
      tools: Object.freeze(extras),
      readOnly: settings.readOnly,
    }),
  });
}

/** The typed refusal for a registered but unpublished tool, built from the stored reason. */
export function unavailableError(policy: PublishedPolicy, tool: string): ToolUnavailableError | undefined {
  const setting = policy.hidden.get(tool);
  return setting ? new ToolUnavailableError(tool, setting) : undefined;
}
