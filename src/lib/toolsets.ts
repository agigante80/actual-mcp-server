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
 *   MCP_TOOL_SURFACE  (#671) which LIST is published: the compact registry (src/compact/, the
 *                  default since #680), the legacy tools, or both. Toolsets always name legacy
 *                  tools. MCP_TOOLS names legacy tools under `legacy` and `all`, compact tools
 *                  under `compact` (#680).
 *
 * Design rules, each the answer to a way this can go wrong:
 *   - ONE source. resolvePublishedToolNames is pure and runs once, in
 *     actualToolsManager.initialize(), from the validated config. It returns a frozen
 *     policy (the published set plus a per-tool hide reason; the hide map is a ReadonlyMap
 *     by type only, since Object.freeze does not reach Map contents). Nothing reads
 *     process.env at dispatch time.
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
import { resolveToolAlias } from './tool-aliases.js';

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
    'actual_transactions_merge',
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
    'actual_budgets_get_month',
    'actual_budgets_get_months',
    'actual_budgets_set_amount',
    'actual_budgets_set_carryover',
    'actual_budgets_hold_for_next_month',
    'actual_budgets_reset_hold',
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
    'actual_schedules_dates',
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
 * actual_budgets_get_month is in it on purpose (decision recorded on #483): budget_updates_batch
 * and budgets_set_amount tell the model to read a month back with it, and query_run has no
 * budget-month table to stand in. actual_budgets_get_months is NOT in it: the out-of-range
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
    'actual_budgets_set_amount',
    'actual_budgets_get_month',
  ],
} as const satisfies Record<string, readonly string[]>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

/**
 * Every tool that can change a budget or server state, for MCP_READ_ONLY.
 *
 * Derived by hand from the adapter call graph: the 43 tools whose adapter path reaches
 * queueWriteOperation, plus the four that mutate WITHOUT the write queue (bank_sync imports
 * transactions through withActualApiWrite, budgets_export writes a zip to ACTUAL_EXPORT_DIR,
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
  'actual_budgets_hold_for_next_month',
  'actual_budgets_import',
  'actual_budgets_reset_hold',
  'actual_budgets_set_amount',
  'actual_budgets_set_carryover',
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
  'actual_transactions_merge',
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
  /** MCP_TOOL_SURFACE (#671). Optional: a three-field caller (the pure unit tests) gets `legacy`; the server always passes the validated config value, `compact` by default. */
  surface?: ToolSurface;
}

/** Which tool list a process publishes (#671). `compact` is the default since #680; `legacy` is the opt-out. */
export type ToolSurface = 'legacy' | 'compact' | 'all';

/**
 * What the resolver needs to know about one compact tool (#671): its name, and the legacy
 * tools its actions call, so MCP_READ_ONLY can hide a compact tool that could write.
 */
export interface CompactPublication {
  readonly name: string;
  readonly legacy: readonly string[];
}

/**
 * The resolved publication policy for one process. The policy object, `published` and
 * `settings` are frozen. `hidden` is a ReadonlyMap by type only (Object.freeze does not
 * freeze Map contents). The refusal decision keys on the frozen `published` list, so
 * altering `hidden` cannot unhide a tool; `hidden` only supplies the reason.
 */
export interface PublishedPolicy {
  /** Published tool names, in registry order. */
  readonly published: readonly string[];
  /** Registered names that are NOT published, mapped to the setting that hides them. */
  readonly hidden: ReadonlyMap<string, ToolUnavailableSetting>;
  /** Count of registered tools: legacy plus compact (#671). */
  readonly registered: number;
  /** #652: deprecated names in MCP_TOOLS and the names they were mapped to, for a startup warning. */
  readonly mappedAliases: readonly { readonly alias: string; readonly tool: string }[];
  /** The resolved settings, for server_info and the startup log. */
  readonly settings: {
    readonly toolsets: readonly string[];
    readonly tools: readonly string[];
    readonly readOnly: boolean;
    readonly surface: ToolSurface;
  };
}

const splitList = (raw: string): string[] =>
  raw.split(',').map((t) => t.trim()).filter(Boolean);

interface LegacyResolution {
  readonly published: string[];
  readonly hidden: Map<string, ToolUnavailableSetting>;
  readonly requested: string[];
  readonly extras: string[];
  /** Legacy names MCP_TOOLSETS and MCP_TOOLS select, before MCP_READ_ONLY is applied. */
  readonly selected: ReadonlySet<string>;
  readonly mappedAliases: { alias: string; tool: string }[];
}

/**
 * The legacy publication algorithm (#483, unchanged): MCP_TOOLSETS, MCP_TOOLS and
 * MCP_READ_ONLY over the legacy registry. It validates the settings (an unknown name throws)
 * but does NOT reject an empty result: the caller judges the final list, which may include
 * compact tools.
 */
function resolveLegacy(registeredNames: readonly string[], settings: ToolsetSettings): LegacyResolution {
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

  // #652: a deprecated alias maps to its new name BEFORE the unknown-name check, so an
  // existing MCP_TOOLS keeps working through the deprecation window.
  const mappedAliases: { alias: string; tool: string }[] = [];
  // De-duplicated after mapping: an operator migrating may list the old and the new name side
  // by side, which must publish (and report) the tool once.
  const extras = [...new Set(splitList(settings.tools).map((t) => {
    const tool = resolveToolAlias(t);
    if (tool !== t) mappedAliases.push(Object.freeze({ alias: t, tool }));
    return tool;
  }))];
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
    // Read-only is checked FIRST: while it is on, adding a writer to MCP_TOOLSETS or MCP_TOOLS
    // cannot publish it, so MCP_READ_ONLY is the setting to change first when both hide a tool.
    if (settings.readOnly && WRITE_CAPABLE.has(name)) hidden.set(name, 'MCP_READ_ONLY');
    else if (!selected.has(name)) hidden.set(name, 'MCP_TOOLSETS');
    else published.push(name);
  }

  return { published, hidden, requested, extras, selected, mappedAliases };
}

/**
 * Resolve the publication policy. Pure: same inputs, same policy, no environment reads.
 * Throws (a startup failure) on an unknown toolset, preset or tool name, on a group or
 * preset naming an unregistered tool, on a compact tool whose name collides with a legacy
 * one, and on a configuration that publishes nothing.
 *
 * Surfaces (#671), over the legacy names and the compact tools:
 *   legacy   today's algorithm on the legacy names; every compact tool is hidden (MCP_TOOL_SURFACE).
 *   compact  every legacy name is hidden (MCP_TOOL_SURFACE, or its legacy reason when
 *            MCP_TOOLSETS or MCP_READ_ONLY hides it anyway). A compact tool is published when
 *            at least one legacy tool its actions call is selected by MCP_TOOLSETS, or it is
 *            named in MCP_TOOLS (#680, decisions R1 and R2 on the ticket), and it is hidden
 *            whole under MCP_READ_ONLY=true when one of its actions maps to a WRITE_CAPABLE
 *            tool. MCP_TOOLS takes compact names only: a legacy name stops startup.
 *   all      the legacy result plus the compact tools under the same read-only rule.
 *
 * The compact toolset rule decides only what is LISTED. What an ACTION may call is still
 * decided per legacy operation: a legacy tool that MCP_TOOLSETS or MCP_READ_ONLY hides keeps
 * that hide reason, so callOperation refuses it naming that setting even though its compact
 * tool is listed (for example `manage_transactions` action `import` under MCP_TOOLSETS=chat).
 * Under `all`, MCP_TOOLSETS and MCP_TOOLS select among LEGACY names only and never hide a
 * compact tool.
 */
export function resolvePublishedToolNames(
  registeredNames: readonly string[],
  settings: ToolsetSettings,
  compactTools: readonly CompactPublication[] = [],
): PublishedPolicy {
  const surface: ToolSurface = settings.surface ?? 'legacy';
  const legacyNames = new Set(registeredNames);
  const collisions = compactTools.filter((c) => legacyNames.has(c.name)).map((c) => c.name);
  if (collisions.length > 0) {
    throw new Error(`Compact tool name collides with a registered tool: ${collisions.join(', ')}`);
  }

  // Under `compact`, MCP_TOOLS names COMPACT tools (#680 R2). The legacy algorithm never sees
  // it; a compact tool named there selects every legacy tool its actions call, so each of its
  // actions works, while MCP_READ_ONLY still wins over it (it hides in the legacy pass).
  const compactExtras: string[] = [];
  let legacySettings = settings;
  if (surface === 'compact') {
    const compactNames = new Set(compactTools.map((c) => c.name));
    compactExtras.push(...new Set(splitList(settings.tools)));
    const unknown = compactExtras.filter((t) => !compactNames.has(t));
    if (unknown.length > 0) {
      const legacyNamed = unknown.filter((t) => legacyNames.has(t) || resolveToolAlias(t) !== t);
      throw new Error(
        `Unknown tool in MCP_TOOLS: ${unknown.map((t) => `"${t}"`).join(', ')}. ` +
          (legacyNamed.length > 0
            ? `${legacyNamed.map((t) => `"${t}"`).join(', ')} ${legacyNamed.length === 1 ? 'is a legacy tool name' : 'are legacy tool names'}, ` +
              `which MCP_TOOL_SURFACE=compact does not publish; use a compact tool name or set MCP_TOOL_SURFACE=legacy. `
            : '') +
          `Compact tools: ${[...compactNames].sort().join(', ')}`,
      );
    }
    legacySettings = { ...settings, tools: '' };
  } else if (surface === 'legacy') {
    // The mirror of the compact case above: a compact name under `legacy` stops startup naming
    // the setting that would publish it, instead of the generic hint to use an actual_ name.
    const compactNames = new Set(compactTools.map((c) => c.name));
    const compactNamed = [...new Set(splitList(settings.tools))].filter((t) => compactNames.has(t));
    if (compactNamed.length > 0) {
      throw new Error(
        `Unknown tool in MCP_TOOLS: ${compactNamed.map((t) => `"${t}"`).join(', ')}. ` +
          `${compactNamed.length === 1 ? 'It is a compact tool name' : 'They are compact tool names'}, ` +
          `which MCP_TOOL_SURFACE=legacy does not publish; use a legacy tool name (for example actual_accounts_list) or set MCP_TOOL_SURFACE=compact.`,
      );
    }
  }
  const legacy = resolveLegacy(registeredNames, legacySettings);
  const selectedLegacy = new Set(legacy.selected);
  if (surface === 'compact') {
    for (const tool of compactTools) {
      if (compactExtras.includes(tool.name)) tool.legacy.forEach((n) => selectedLegacy.add(n));
    }
  }
  const published: string[] = [];
  const hidden = new Map<string, ToolUnavailableSetting>();

  for (const name of registeredNames) {
    // The legacy reason wins over the surface reason, also under `compact`: callOperation
    // waves through ONLY a tool whose sole hide is the surface, so a tool that MCP_TOOLSETS or
    // MCP_READ_ONLY would hide anyway stays refused even if config.ts stops rejecting the
    // combination (#680 relaxed that refine, so compact now runs with a narrowed MCP_TOOLSETS).
    // A legacy tool selected only through a compact MCP_TOOLS entry is not an MCP_TOOLSETS hide.
    if (legacy.hidden.has(name) && !(legacy.hidden.get(name) === 'MCP_TOOLSETS' && selectedLegacy.has(name))) {
      hidden.set(name, legacy.hidden.get(name)!);
    } else if (surface === 'compact') hidden.set(name, 'MCP_TOOL_SURFACE');
    else published.push(name);
  }
  for (const tool of compactTools) {
    if (surface === 'legacy') hidden.set(tool.name, 'MCP_TOOL_SURFACE');
    // A tool that mixes reads and writes is hidden whole under read-only, by design.
    else if (settings.readOnly && tool.legacy.some((n) => WRITE_CAPABLE.has(n))) hidden.set(tool.name, 'MCP_READ_ONLY');
    // Listed when any action's legacy tool is selected (#680 R1, option A); the rest refuse per action.
    else if (surface === 'compact' && !tool.legacy.some((n) => selectedLegacy.has(n))) hidden.set(tool.name, 'MCP_TOOLSETS');
    else published.push(tool.name);
  }

  const total = registeredNames.length + compactTools.length;
  // Partition invariant: every registered name is exactly one of published or hidden.
  if (published.length + hidden.size !== total || published.some((n) => hidden.has(n))) {
    throw new Error('toolsets: published and hidden must partition the registry');
  }

  if (published.length === 0) {
    throw new Error(
      `No tools would be published: MCP_TOOL_SURFACE="${surface}", MCP_TOOLSETS="${settings.toolsets}", MCP_TOOLS="${settings.tools}" and ` +
        `MCP_READ_ONLY=${settings.readOnly} resolve to 0 tools. For example, a toolset made only of writers ` +
        `(structure) publishes nothing under MCP_READ_ONLY=true.`,
    );
  }

  return Object.freeze({
    published: Object.freeze(published),
    hidden,
    registered: total,
    mappedAliases: Object.freeze(legacy.mappedAliases),
    settings: Object.freeze({
      toolsets: Object.freeze(legacy.requested),
      tools: Object.freeze(surface === 'compact' ? compactExtras : legacy.extras),
      readOnly: settings.readOnly,
      surface,
    }),
  });
}

/**
 * The typed refusal for a registered but unpublished tool. Fails CLOSED: the decision is the
 * frozen `published` list; `hidden` only supplies the reason. The fallback reason is
 * unreachable in production because the resolver enforces the partition invariant.
 */
export function unavailableError(policy: PublishedPolicy, tool: string): ToolUnavailableError | undefined {
  if (policy.published.includes(tool)) return undefined;
  const reason = policy.hidden.get(tool) ?? 'MCP_TOOLSETS';
  // Under `compact` no legacy tool is published whatever MCP_TOOLSETS says, so a direct call to
  // one is refused naming the surface: widening MCP_TOOLSETS would not help the caller. Only
  // this direct-call path does so; operationUnavailableError must keep the MCP_TOOLSETS reason.
  if (reason === 'MCP_TOOLSETS' && policy.settings?.surface === 'compact' && tool.startsWith('actual_')) {
    return new ToolUnavailableError(tool, 'MCP_TOOL_SURFACE', 'compact');
  }
  return new ToolUnavailableError(tool, reason, policy.settings?.surface);
}

/**
 * The read-only check shared by BOTH ways into a legacy tool (#671): callToolChecked and
 * callOperation. It decides from MCP_READ_ONLY and the hard-coded WRITE_CAPABLE set, never
 * from annotations, and never from `hidden`, so a surface that hides a writer for another
 * reason (compact) still refuses it with the read-only message.
 */
export function readOnlyError(policy: PublishedPolicy, tool: string): ToolUnavailableError | undefined {
  if (policy.settings?.readOnly && WRITE_CAPABLE.has(tool)) return new ToolUnavailableError(tool, 'MCP_READ_ONLY');
  return undefined;
}

/**
 * The publication check for callOperation (#671, design record section 4a). It skips ONLY the
 * hide that the compact surface itself causes: legacy tools stay registered and merely
 * unpublished under `compact`. A tool hidden for any other reason (MCP_TOOLSETS, under
 * `all`) is still refused naming that setting, exactly as a direct call is. Fails closed:
 * a missing hide reason counts as MCP_TOOLSETS, and the bypass needs the `compact` surface.
 */
export function operationUnavailableError(policy: PublishedPolicy, tool: string): ToolUnavailableError | undefined {
  if (policy.published.includes(tool)) return undefined;
  const reason = policy.hidden.get(tool) ?? 'MCP_TOOLSETS';
  if (reason === 'MCP_TOOL_SURFACE' && policy.settings?.surface === 'compact') return undefined;
  return new ToolUnavailableError(tool, reason, policy.settings?.surface);
}
