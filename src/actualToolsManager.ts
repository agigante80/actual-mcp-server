// src/actualToolsManager.ts
import logger from './logger.js';
import { z } from 'zod';

import { checkToolOutput, type CheckedToolResult, type ToolDefinitionWithOutput } from './lib/tool-output.js';
import { formatZodError } from './lib/zod-error-format.js';
import { errorLogFields } from './lib/errors.js';
import config from './config.js';
import { createModuleLogger } from './lib/loggerFactory.js';
import { resolvePublishedToolNames, unavailableError, type PublishedPolicy, type ToolsetSettings } from './lib/toolsets.js';
import { TOOL_ALIAS_REMOVAL_AFTER, resolveToolAlias } from './lib/tool-aliases.js';

const toolsetLog = createModuleLogger('TOOLSETS');
const outputLog = createModuleLogger('TOOL_OUTPUT');
const aliasLog = createModuleLogger('TOOL_ALIAS');

// #652: each deprecated alias warns once per process, not once per call.
const warnedAliases = new Set<string>();

// ✅ List of tools already implemented in this class.
// Adding the tool name here is considered fully implemented.
const IMPLEMENTED_TOOLS = [
  'actual_account_flow_summary',
  'actual_recurring_expenses_summary',
  'actual_accounts_close',
  'actual_accounts_create',
  'actual_accounts_delete',
  'actual_accounts_get_balance',
  'actual_account_groups_list',
  'actual_account_groups_create',
  'actual_account_groups_update',
  'actual_account_groups_delete',
  'actual_accounts_list',
  'actual_accounts_reopen',
  'actual_accounts_update',
  'actual_bank_sync',
  'actual_budgets_get_all',
  'actual_budgets_list_available',
  'actual_budgets_switch',
  'actual_budgets_get_month',
  'actual_budgets_get_months',
  'actual_budgets_hold_for_next_month',
  'actual_budgets_reset_hold',
  'actual_budgets_set_amount',
  'actual_budgets_set_carryover',
  'actual_budgets_transfer',
  'actual_budget_updates_batch',
  'actual_categories_create',
  'actual_categories_delete',
  'actual_categories_get',
  'actual_categories_update',
  'actual_category_groups_create',
  'actual_category_groups_delete',
  'actual_category_groups_get',
  'actual_category_groups_update',
  'actual_payees_common_list',
  'actual_payees_create',
  'actual_payees_delete',
  'actual_payees_get',
  'actual_payees_merge',
  'actual_payees_update',
  'actual_payee_rules_get',
  'actual_query_run',
  'actual_rules_create',
  'actual_rules_create_batch',
  'actual_rules_create_or_update',
  'actual_rules_delete',
  'actual_rules_get',
  'actual_rules_update',
  'actual_schedules_create',
  'actual_schedules_dates',
  'actual_schedules_delete',
  'actual_schedules_get',
  'actual_schedules_update',
  'actual_transactions_aggregate',
  'actual_transactions_create',
  'actual_transactions_delete',
  'actual_transactions_merge',
  'actual_transactions_filter',
  'actual_transactions_get',
  'actual_transactions_import',
  'actual_transactions_search_by_amount',
  'actual_transactions_search_by_category',
  'actual_transactions_search_by_month',
  'actual_transactions_search_by_payee',
  'actual_transactions_summary_by_category',
  'actual_transactions_summary_by_payee',
  'actual_transactions_uncategorized',
  'actual_transactions_update',
  'actual_transactions_update_batch',
  'actual_transfers_create',
  'actual_server_info',
  'actual_session_close',
  'actual_session_list',
  'actual_get_id_by_name',
  'actual_entities_search',
  'actual_server_get_version',
  'actual_tags_list',
  'actual_tags_create',
  'actual_tags_update',
  'actual_tags_delete',
  'actual_notes_get',
  'actual_notes_update',
  'actual_budgets_export',
  'actual_budgets_import',
  'actual_preferences_get',
  'actual_get_context',
];

// 🔑 Mapping of Actual API function names → your MCP tool names
// This allows us to compare what exists in the API vs. what it has been wrapped.
const API_TOOL_MAP: Record<string, string> = {
  getAccounts: 'actual_accounts_list',
  createAccount: 'actual_accounts_create',
  updateAccount: 'actual_accounts_update',
  deleteAccount: 'actual_accounts_delete',
  getAccountBalance: 'actual_accounts_get_balance',
  getTransactions: 'actual_transactions_get',
  addTransactions: 'actual_transactions_create',
  importTransactions: 'actual_transactions_import',
  updateTransaction: 'actual_transactions_update',
  deleteTransaction: 'actual_transactions_delete',
  mergeTransactions: 'actual_transactions_merge',
  getBudgetMonths: 'actual_budgets_get_months',
  getBudgetMonth: 'actual_budgets_get_month',
  setBudgetAmount: 'actual_budgets_set_amount',
  setBudgetCarryover: 'actual_budgets_set_carryover',
  getCategories: 'actual_categories_get',
  createCategory: 'actual_categories_create',
  updateCategory: 'actual_categories_update',
  deleteCategory: 'actual_categories_delete',
  getPayees: 'actual_payees_get',
  createPayee: 'actual_payees_create',
  updatePayee: 'actual_payees_update',
  deletePayee: 'actual_payees_delete',
  mergePayees: 'actual_payees_merge',
  getPayeeRules: 'actual_payee_rules_get',
  // #539: the tool covers this capability through per-item writes; it never calls batchBudgetUpdates.
  batchBudgetUpdates: 'actual_budget_updates_batch',
  holdBudgetForNextMonth: 'actual_budgets_hold_for_next_month',
  resetBudgetHold: 'actual_budgets_reset_hold',
  getRules: 'actual_rules_get',
  createRule: 'actual_rules_create',
  updateRule: 'actual_rules_update',
  deleteRule: 'actual_rules_delete',
  closeAccount: 'actual_accounts_close',
  reopenAccount: 'actual_accounts_reopen',
  getCategoryGroups: 'actual_category_groups_get',
  createCategoryGroup: 'actual_category_groups_create',
  updateCategoryGroup: 'actual_category_groups_update',
  deleteCategoryGroup: 'actual_category_groups_delete',
  getIDByName: 'actual_get_id_by_name',
  getServerVersion: 'actual_server_get_version',
  exportBudget: 'actual_budgets_export',
  importBudget: 'actual_budgets_import',
  getPreferences: 'actual_preferences_get',
};

class ActualToolsManager {
  private tools: Map<string, ToolDefinitionWithOutput> = new Map();
  // Resolved ONCE in initialize() (#483) and never recomputed. Null before that, and every
  // accessor below throws rather than fall back to "all tools", so a caller that runs
  // before initialize() fails closed instead of publishing a surface the operator hid.
  private policy: PublishedPolicy | null = null;

  constructor() {}

  /**
   * @param settings Overrides the validated config. Production passes nothing; the unit
   *   tests pass explicit settings so they never depend on process.env.
   */
  async initialize(settings: ToolsetSettings = {
    toolsets: config.MCP_TOOLSETS,
    tools: config.MCP_TOOLS,
    readOnly: config.MCP_READ_ONLY,
  }) {
    // Dynamically import all tool modules from src/tools/index.ts
    const toolModules = (await import('./tools/index.js')) as Record<string, unknown>;
    let count = 0;
    for (const [_key, tool] of Object.entries(toolModules)) {
      const t = tool as unknown as { name?: string };
      if (t && t.name) {
        this.tools.set(t.name, tool as unknown as ToolDefinitionWithOutput);
        count++;
      }
    }
    logger.info(`🔗 Loaded ${count} tool modules from src/tools`);

    // Throws on an unknown name or an empty result: startup fails loudly (#483).
    this.policy = resolvePublishedToolNames(this.getToolNames(), settings);
    toolsetLog.info(
      `Publishing ${this.policy.published.length} of ${this.policy.registered} registered tools`,
      {
        published: this.policy.published.length,
        registered: this.policy.registered,
        toolsets: this.policy.settings.toolsets,
        extraTools: this.policy.settings.tools,
        readOnly: this.policy.settings.readOnly,
      },
    );
    for (const { alias, tool } of this.policy.mappedAliases) {
      toolsetLog.warn('MCP_TOOLS names a deprecated tool alias; use the new name', {
        alias,
        tool,
        removal: TOOL_ALIAS_REMOVAL_AFTER,
      });
    }
  }

  private requirePolicy(): PublishedPolicy {
    if (!this.policy) {
      throw new Error('Tool publication policy is not resolved: actualToolsManager.initialize() has not run');
    }
    return this.policy;
  }

  /** The tools this process publishes (tools/list) and dispatches, in registry order. */
  getPublishedToolNames(): string[] {
    return [...this.requirePolicy().published];
  }

  /** The resolved MCP_TOOLSETS / MCP_TOOLS / MCP_READ_ONLY, for server_info. */
  getToolPolicy(): { toolsets: string[]; tools: string[]; readOnly: boolean } {
    const { toolsets, tools, readOnly } = this.requirePolicy().settings;
    return { toolsets: [...toolsets], tools: [...tools], readOnly };
  }

  /** How many tools exist, published or not, for the sys_startup record (#623). */
  getRegisteredToolCount(): number {
    return this.tools.size;
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getTool(name: string): ToolDefinitionWithOutput | undefined {
    return this.tools.get(name);
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return (await this.callToolChecked(name, args)).value;
  }

  /**
   * callTool plus the outputSchema verdict (#642). The verdict is computed against the
   * JSON-safe value, the same one the text block serialises, so the transports only frame.
   */
  async callToolChecked(requestedName: string, args: unknown): Promise<CheckedToolResult> {
    // #652: a deprecated alias resolves FIRST, so registration and publication below judge
    // the new name. getTool() deliberately does not resolve aliases.
    const name = resolveToolAlias(requestedName);
    if (name !== requestedName && !warnedAliases.has(requestedName)) {
      warnedAliases.add(requestedName);
      aliasLog.warn('A deprecated tool alias was called; use the new name', {
        tool: name,
        alias: requestedName,
        removal: TOOL_ALIAS_REMOVAL_AFTER,
      });
    }
    const policy = this.requirePolicy();
    // Registration is checked BEFORE publication: an unregistered name stays "not found".
    const tool = this.getTool(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    // Hide AND refuse (#483): omitting a tool from tools/list is not access control.
    const unavailable = unavailableError(policy, name);
    if (unavailable) {
      toolsetLog.warn('Refused a call to an unpublished tool', { tool: name, setting: unavailable.setting });
      throw unavailable;
    }
    const startTime = Date.now();
    try {
      const result = await tool.call(args);

      // Force-serialize/deserialize to ensure result is JSON-safe (no circular refs,
      // Buffers, class instances, etc). Convert undefined -> null so callers always
      // receive a valid JSON value.
      const json = JSON.stringify(result === undefined ? null : result);
      const safe = JSON.parse(json);

      // Content-free by design (#556): tool arguments and results are the user's budget
      // data and never reach the logs. This record is the one place content COULD be
      // logged, so an opt-in for debugging (#557) belongs here and nowhere else.
      // `durationMs`, not `ms`: the logger reserves a top-level `ms` key (src/logger.ts).
      const verdict = checkToolOutput(tool, safe);
      const mismatch = verdict?.check === 'mismatch';
      logger.info('[TOOL RESULT]', { tool: name, durationMs: Date.now() - startTime, outcome: mismatch ? 'output_mismatch' : 'ok', bytes: Buffer.byteLength(json, 'utf8') });
      if (mismatch) {
        // Tool name and Zod issue paths only: the values are budget data (#556).
        outputLog.warn('Tool result does not match its outputSchema; returning it as an error', { tool: name, issuePaths: verdict?.issuePaths });
      }
      return { value: safe, ...(verdict ? { check: verdict.check, ...(mismatch ? { issuePaths: verdict.issuePaths } : {}) } : {}) };
    } catch (err: unknown) {
      // Format Zod validation errors into one actionable, consistent message (#206).
      // Duck-type on `.issues` so any structurally-compatible ZodError is handled.
      // The failure record mirrors the success one (#556): tool, duration and outcome,
      // never the arguments. It never carries the error MESSAGE either (#559): that text
      // is for the client and can quote input or upstream content. errorLogFields gives
      // the class, a refusal's kind, and the throw site's withLogMessage text if any.
      const failure = { tool: name, durationMs: Date.now() - startTime, outcome: 'error' };
      if (err && typeof err === 'object' && 'issues' in err) {
        const formattedMsg = formatZodError(err as z.ZodError, tool.inputSchema);
        // The #206 text is for the client only: a schema's custom refine message can quote
        // input (transactions_create echoes the split amounts), so the log gets the issue
        // codes, which come from Zod and never from the arguments.
        const issueCodes = [...new Set(((err as z.ZodError).issues ?? []).map((i) => String(i?.code)))];
        logger.error(`[TOOL ERROR] ${name}`, { ...failure, errorClass: 'ZodError', issueCodes });
        throw new Error(formattedMsg);
      }

      logger.error(`[TOOL ERROR] ${name}`, { ...failure, ...errorLogFields(err) });
      throw err;
    }
  }

  /**
   * Get coverage statistics comparing implemented tools with available API methods
   */
  getCoverageStats() {
    const apiMethods = Object.keys(API_TOOL_MAP);
    const mappedTools = Object.values(API_TOOL_MAP);
    const implemented = IMPLEMENTED_TOOLS;
    
    const missing = mappedTools.filter(tool => !implemented.includes(tool));
    const coverage = (implemented.length / mappedTools.length) * 100;
    
    return {
      totalApiMethods: apiMethods.length,
      totalMappedTools: mappedTools.length,
      implementedTools: implemented.length,
      missingTools: missing.length,
      coveragePercent: Math.round(coverage * 100) / 100,
      missingToolsList: missing,
    };
  }

  /**
   * Get the API method name for a given tool name
   */
  getApiMethodForTool(toolName: string): string | undefined {
    return Object.entries(API_TOOL_MAP).find(([_, tool]) => tool === toolName)?.[0];
  }

  /**
   * Get the tool name for a given API method
   */
  getToolForApiMethod(apiMethod: string): string | undefined {
    return API_TOOL_MAP[apiMethod];
  }
}

export default new ActualToolsManager();
