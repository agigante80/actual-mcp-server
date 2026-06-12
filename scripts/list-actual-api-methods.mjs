// scripts/list-actual-api-methods.mjs
//
// API coverage auditor (#187). Reports, for every @actual-app/api method,
// whether it is exposed as an MCP tool, intentionally internal, or a genuine
// uncovered gap. The earlier version hardcoded a 37-entry tool list that drifted
// from reality; this version sources the tool set by text-parsing
// IMPLEMENTED_TOOLS from src/actualToolsManager.ts (the same precedent
// scripts/version-bump.js uses), so the "implemented" set can never drift again.
//
// Exports analyzeCoverage() for tests/unit/check_coverage.test.js, and prints a
// three-bucket report when run directly (npm run check:coverage).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// The single source of truth for implemented tools: the IMPLEMENTED_TOOLS array
// in src/actualToolsManager.ts, read as text (each entry is on its own line as
// 'actual_...'). Mirrors scripts/version-bump.js, which text-parses the same file.
export function readImplementedTools() {
  const src = readFileSync(resolve(here, '..', 'src', 'actualToolsManager.ts'), 'utf8');
  // Tool names can contain uppercase (e.g. actual_budgets_getMonths), so allow A-Z.
  return (src.match(/^\s*'(actual_[A-Za-z0-9_]+)'/gm) || []).map(line => line.match(/'(actual_[A-Za-z0-9_]+)'/)[1]);
}

// Explicit, reviewed mapping from an @actual-app/api method to the tool(s) that
// cover it. One tool may cover several methods (the ActualQL query primitives).
// Keep this current when a tool is added; the mapping-integrity check in
// analyzeCoverage (and the unit test) fails if a mapped tool name is not in
// IMPLEMENTED_TOOLS.
export const API_TO_TOOL = {
  // accounts
  getAccounts: 'actual_accounts_list',
  createAccount: 'actual_accounts_create',
  updateAccount: 'actual_accounts_update',
  deleteAccount: 'actual_accounts_delete',
  getAccountBalance: 'actual_accounts_get_balance',
  closeAccount: 'actual_accounts_close',
  reopenAccount: 'actual_accounts_reopen',
  // transactions
  getTransactions: 'actual_transactions_get',
  addTransactions: 'actual_transactions_create',
  importTransactions: 'actual_transactions_import',
  updateTransaction: 'actual_transactions_update',
  deleteTransaction: 'actual_transactions_delete',
  // categories + groups
  getCategories: 'actual_categories_get',
  createCategory: 'actual_categories_create',
  updateCategory: 'actual_categories_update',
  deleteCategory: 'actual_categories_delete',
  getCategoryGroups: 'actual_category_groups_get',
  createCategoryGroup: 'actual_category_groups_create',
  updateCategoryGroup: 'actual_category_groups_update',
  deleteCategoryGroup: 'actual_category_groups_delete',
  // payees
  getPayees: 'actual_payees_get',
  createPayee: 'actual_payees_create',
  updatePayee: 'actual_payees_update',
  deletePayee: 'actual_payees_delete',
  mergePayees: 'actual_payees_merge',
  getPayeeRules: 'actual_payee_rules_get',
  getCommonPayees: 'actual_payees_common_list',
  // rules
  getRules: 'actual_rules_get',
  createRule: 'actual_rules_create',
  updateRule: 'actual_rules_update',
  deleteRule: 'actual_rules_delete',
  // budgets
  getBudgetMonths: 'actual_budgets_getMonths',
  getBudgetMonth: 'actual_budgets_getMonth',
  setBudgetAmount: 'actual_budgets_setAmount',
  setBudgetCarryover: 'actual_budgets_setCarryover',
  batchBudgetUpdates: 'actual_budget_updates_batch',
  holdBudgetForNextMonth: 'actual_budgets_holdForNextMonth',
  resetBudgetHold: 'actual_budgets_resetHold',
  getBudgets: 'actual_budgets_list_available',
  // tags (#184)
  getTags: 'actual_tags_list',
  createTag: 'actual_tags_create',
  updateTag: 'actual_tags_update',
  deleteTag: 'actual_tags_delete',
  // notes (#185)
  getNote: 'actual_notes_get',
  updateNote: 'actual_notes_update',
  // schedules
  getSchedules: 'actual_schedules_get',
  createSchedule: 'actual_schedules_create',
  updateSchedule: 'actual_schedules_update',
  deleteSchedule: 'actual_schedules_delete',
  // server / misc
  getServerVersion: 'actual_server_get_version',
  runBankSync: 'actual_bank_sync',
  getIDByName: 'actual_get_id_by_name',
  // ActualQL query primitives are all covered by the one query tool
  aqlQuery: 'actual_query_run',
  q: 'actual_query_run',
  runQuery: 'actual_query_run',
};

// Methods that are intentionally NOT a tool: lifecycle/session primitives the
// adapter manages internally, and the file-based bulk importer (programmatic
// import is already covered by actual_transactions_import).
export const INTERNAL_METHODS = new Set([
  'init',
  'shutdown',
  'sync',
  'loadBudget',
  'downloadBudget',
  'runImport',
]);

/**
 * Classify every API method into covered / internal / genuine gap, and check
 * mapping integrity (every mapped tool name must exist in IMPLEMENTED_TOOLS).
 *
 * @param {object} [opts]
 * @param {string[]} [opts.apiMethodsOverride]  Inject the method list (tests use
 *   this to add a synthetic uncovered method without needing a real gap).
 * @param {string[]} [opts.implementedToolsOverride]
 */
export function analyzeCoverage(opts = {}) {
  const implementedTools = opts.implementedToolsOverride ?? readImplementedTools();
  const implementedSet = new Set(implementedTools);
  const apiMethods = (opts.apiMethodsOverride ?? []).slice().sort();

  const covered = [];   // { method, tool }
  const internal = [];  // method
  const gaps = [];      // method
  for (const method of apiMethods) {
    if (API_TO_TOOL[method]) covered.push({ method, tool: API_TO_TOOL[method] });
    else if (INTERNAL_METHODS.has(method)) internal.push(method);
    else gaps.push(method);
  }

  // Mapping integrity: a mapped tool name must actually be registered.
  const mappingErrors = Object.entries(API_TO_TOOL)
    .filter(([, tool]) => !implementedSet.has(tool))
    .map(([method, tool]) => ({ method, tool }));

  return { apiMethods, implementedTools, covered, internal, gaps, mappingErrors };
}

// ---- CLI report (only when run directly) -----------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ActualApi = await import('@actual-app/api');
  const apiMethods = Object.keys(ActualApi).filter(k => typeof ActualApi[k] === 'function');
  const { implementedTools, covered, internal, gaps, mappingErrors } = analyzeCoverage({ apiMethodsOverride: apiMethods });

  console.log('=== API Coverage Audit ===\n');
  console.log(`Implemented tools (from IMPLEMENTED_TOOLS): ${implementedTools.length}`);
  console.log(`API methods enumerated: ${apiMethods.length}\n`);

  console.log(`Covered (${covered.length}):`);
  covered.forEach(({ method, tool }) => console.log(`   ${method} -> ${tool}`));

  console.log(`\nIntentionally internal (${internal.length}):`);
  internal.forEach(m => console.log(`   ${m}`));

  console.log(`\nGenuine gaps (${gaps.length}):`);
  if (gaps.length === 0) console.log('   (none: every user-facing API method maps to a tool)');
  else gaps.forEach(m => console.log(`   ${m}`));

  if (mappingErrors.length > 0) {
    console.log(`\nMapping errors (mapped tool not in IMPLEMENTED_TOOLS) (${mappingErrors.length}):`);
    mappingErrors.forEach(({ method, tool }) => console.log(`   ${method} -> ${tool} (MISSING)`));
  }

  console.log('\n=== Summary ===');
  console.log(`   Covered: ${covered.length} | Internal: ${internal.length} | Gaps: ${gaps.length} | Mapping errors: ${mappingErrors.length}`);
  if (mappingErrors.length > 0 || gaps.length > 0) {
    console.log('\nNote: gaps or mapping errors found. Add a tool or update the map in this script.');
  }
}
