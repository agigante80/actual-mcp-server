/**
 * src/lib/toolsets.ts (#483)
 *
 * Server-side toolset filtering and preset configuration.
 * Allows operators to control which tools this MCP server publishes and accepts calls for,
 * reducing context token usage for chat clients with small turn limits or context windows.
 *
 * Config knobs:
 *   - MCP_TOOLSETS: Comma-separated list of toolsets ('context', 'transactions', etc.)
 *                   and presets ('chat'). Default: 'all'.
 *   - MCP_TOOLS:    Comma-separated list of additional tool names to publish. Default: empty.
 *   - MCP_READ_ONLY: Boolean ('true' / 'false'). Drops every write-capable tool. Default: 'false'.
 */


export const TOOLSET_GROUPS = [
  'context',
  'transactions',
  'analysis',
  'budget',
  'rules',
  'schedules',
  'structure',
  'query',
  'admin',
] as const;

export type ToolsetGroup = (typeof TOOLSET_GROUPS)[number];

export const TOOLSETS: Record<ToolsetGroup, readonly string[]> = {
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
  query: [
    'actual_query_run',
  ],
  admin: [
    'actual_budgets_switch',
    'actual_budgets_import',
    'actual_budgets_export',
    'actual_bank_sync',
    'actual_session_list',
    'actual_session_close',
  ],
};

export const PRESET_NAMES = ['chat'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESETS: Record<PresetName, readonly string[]> = {
  chat: [
    'actual_get_context',
    'actual_query_run',
    'actual_transactions_update_batch',
    'actual_budget_updates_batch',
    'actual_transactions_create',
    'actual_transactions_update',
    'actual_transactions_delete',
    'actual_rules_create',
    'actual_budgets_transfer',
    'actual_budgets_setAmount',
  ],
};

/**
 * Tools that mutate without going through the write queue (bank sync, export, switch, session close).
 * These are excluded from read-only mode in addition to queueWriteOperation mutators.
 */
export const NON_QUEUE_MUTATORS = [
  'actual_bank_sync',
  'actual_budgets_export',
  'actual_budgets_switch',
  'actual_session_close',
] as const;

/**
 * All tools capable of mutating data or server state.
 * Derived from the adapter call-graph (queueWriteOperation/batchBudgetUpdates) plus NON_QUEUE_MUTATORS.
 * Does NOT branch on tool annotations hints.
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


/**
 * Parse and validate toolset and tool configuration options.
 * Throws loud startup error if unknown toolset, preset, or tool name is encountered.
 */
export function resolvePublishedToolNames(
  allRegisteredTools: string[],
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const registeredSet = new Set(allRegisteredTools);
  const toolsetsInput = (env.MCP_TOOLSETS ?? 'all').trim();
  const toolsInput = (env.MCP_TOOLS ?? '').trim();
  const readOnly = env.MCP_READ_ONLY === 'true';

  const validGroupAndPresets = ['all', ...TOOLSET_GROUPS, ...PRESET_NAMES];

  // Validate presets: every tool named in any preset MUST be registered
  for (const [presetName, presetMembers] of Object.entries(PRESETS)) {
    for (const toolName of presetMembers) {
      if (!registeredSet.has(toolName)) {
        throw new Error(
          `Preset "${presetName}" specifies tool "${toolName}" which is not registered in the tool registry.`
        );
      }
    }
  }

  // Parse MCP_TOOLSETS
  const toolsetTokens = toolsetsInput
    ? toolsetsInput.split(',').map((t) => t.trim()).filter(Boolean)
    : ['all'];

  for (const token of toolsetTokens) {
    if (!validGroupAndPresets.includes(token as any)) {
      throw new Error(
        `Unknown toolset or preset in MCP_TOOLSETS: "${token}". Valid names are: ${validGroupAndPresets.join(', ')}`
      );
    }
  }

  // Collect tools from toolsets / presets
  const selectedTools = new Set<string>();

  if (toolsetTokens.includes('all')) {
    for (const tool of allRegisteredTools) {
      selectedTools.add(tool);
    }
  } else {
    for (const token of toolsetTokens) {
      if (token in TOOLSETS) {
        for (const tool of TOOLSETS[token as ToolsetGroup]) {
          selectedTools.add(tool);
        }
      } else if (token in PRESETS) {
        for (const tool of PRESETS[token as PresetName]) {
          selectedTools.add(tool);
        }
      }
    }
  }

  // Parse MCP_TOOLS (extra tools)
  if (toolsInput) {
    const extraToolTokens = toolsInput.split(',').map((t) => t.trim()).filter(Boolean);
    for (const token of extraToolTokens) {
      // Support both exact name (actual_foo) and unprefixed name (foo)
      let resolvedName = token;
      if (!registeredSet.has(resolvedName) && registeredSet.has(`actual_${token}`)) {
        resolvedName = `actual_${token}`;
      }
      if (!registeredSet.has(resolvedName)) {
        throw new Error(
          `Unknown tool name in MCP_TOOLS: "${token}". Tool is not registered in the tool registry.`
        );
      }
      selectedTools.add(resolvedName);
    }
  }

  // Filter against allRegisteredTools to preserve canonical registry ordering
  let published = allRegisteredTools.filter((t) => selectedTools.has(t));

  // Apply MCP_READ_ONLY filter
  if (readOnly) {
    published = published.filter((t) => !WRITE_CAPABLE.has(t));
  }

  if (published.length === 0) {
    throw new Error(
      `No tools published: the configuration resulting from MCP_TOOLSETS="${toolsetsInput}", ` +
      `MCP_TOOLS="${toolsInput}", and MCP_READ_ONLY=${readOnly} resolved to 0 tools.`
    );
  }

  return published;
}

/**
 * Returns the actionable error reason when a client attempts to call an unpublished tool.
 */
export function getUnpublishedRefusalReason(
  toolName: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const readOnly = env.MCP_READ_ONLY === 'true';
  if (readOnly && WRITE_CAPABLE.has(toolName)) {
    return `Tool "${toolName}" is not available: write operations are disabled by MCP_READ_ONLY.`;
  }
  return `Tool "${toolName}" is not published by the current MCP_TOOLSETS configuration.`;
}
