// tests/unit/check_coverage.test.js
//
// #187: guards the API coverage auditor (scripts/list-actual-api-methods.mjs).
// The old script hardcoded a 37-entry tool list that drifted from the real 70.
// This test asserts the auditor now (a) sources the tool set from the real
// registry (count matches the dist tool files), (b) maps every method to a tool
// that actually exists (mapping integrity), (c) never buckets a covered method
// as a gap, (d) buckets lifecycle methods as internal, and still (f) surfaces a
// real gap when one exists (via a synthetic method).
//
// #321: this file is HERMETIC. It used to enumerate the LIVE @actual-app/api
// surface and assert the genuine-gaps bucket was empty, which made a unit test's
// result change with no commit: 26.8.0 added exportBudget, getPreferences and
// importBudget and turned it red, killing the auto-release train for two nights
// and blocking security PR #319. The live enumeration is gone, replaced by
// FROZEN_API_SURFACE below, and the live-surface emptiness assertion has moved
// out of the unit suite entirely into the api-surface-drift lane, where a gap is
// reported rather than blocking.
//
// Run: node tests/unit/check_coverage.test.js

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeCoverage, readImplementedTools, API_TO_TOOL, INTERNAL_METHODS } =
  await import('../../scripts/list-actual-api-methods.mjs');

let passed = 0, failed = 0;
function ok(m) { console.log(`  PASS: ${m}`); passed++; }
function bad(m) { console.error(`  FAIL: ${m}`); failed++; }
function assert(c, m) { c ? ok(m) : bad(m); }

console.log('Running #187 check:coverage auditor tests');

// Frozen surface of @actual-app/api 26.7.0 (61 exported functions), captured by
// hand. This is a FIXTURE, not a mirror: it is NEVER regenerated from
// node_modules by any script, and is updated only by a deliberate human commit.
// A fixture that auto-refreshes is not hermetic, which is the entire point of
// this file. Deliberately SEPARATE from docs/audit/api-coverage-baseline.json:
// this array is a fake surface for classifier assertions, that file is the list
// of accepted real gaps.
const FROZEN_API_SURFACE = [
  'addTransactions', 'aqlQuery', 'batchBudgetUpdates', 'closeAccount', 'createAccount',
  'createCategory', 'createCategoryGroup', 'createPayee', 'createRule', 'createSchedule',
  'createTag', 'deleteAccount', 'deleteCategory', 'deleteCategoryGroup', 'deletePayee',
  'deleteRule', 'deleteSchedule', 'deleteTag', 'deleteTransaction', 'downloadBudget',
  'getAccountBalance', 'getAccounts', 'getBudgetMonth', 'getBudgetMonths', 'getBudgets',
  'getCategories', 'getCategoryGroups', 'getCommonPayees', 'getIDByName', 'getNote',
  'getPayeeRules', 'getPayees', 'getRules', 'getSchedules', 'getServerVersion',
  'getTags', 'getTransactions', 'holdBudgetForNextMonth', 'importTransactions', 'init',
  'loadBudget', 'mergePayees', 'q', 'reopenAccount', 'resetBudgetHold', 'runBankSync',
  'runImport', 'runQuery', 'setBudgetAmount', 'setBudgetCarryover', 'shutdown', 'sync',
  'updateAccount', 'updateCategory', 'updateCategoryGroup', 'updateNote', 'updatePayee',
  'updateRule', 'updateSchedule', 'updateTag', 'updateTransaction',
];

// (a) the parser matches the real registry (catches the original under-report).
console.log('\n[registry sourcing]');
{
  const tools = readImplementedTools();
  const fileCount = readdirSync(resolve(here, '../../dist/src/tools'))
    .filter(f => f.endsWith('.js') && f !== 'index.js').length;
  assert(tools.length === fileCount,
    `parser tool count (${tools.length}) equals dist tool-file count (${fileCount})`);
  assert(new Set(tools).size === tools.length, 'no duplicate tool names parsed');
  assert(tools.every(t => t.startsWith('actual_')), 'every parsed name is an actual_ tool');
  // The pre-#187 bug: a hardcoded 37. Ensure we are well past that.
  assert(tools.length > 37, `parser is not stuck at the old hardcoded count (${tools.length} > 37)`);
}

// (b)-(d) classify the FROZEN surface. These assert analyzeCoverage's bucketing,
// which is entirely our code; the live method names are merely fixtures. The
// live-surface `gaps.length === 0` assertion is deliberately NOT here: that is
// the one genuinely external claim and it belongs to the drift lane.
console.log('\n[coverage analysis: frozen API surface]');
{
  const { covered, internal, gaps, mappingErrors } = analyzeCoverage({ apiMethodsOverride: FROZEN_API_SURFACE });
  assert(mappingErrors.length === 0,
    `no mapping errors (every mapped tool exists in IMPLEMENTED_TOOLS); got ${JSON.stringify(mappingErrors)}`);
  assert(covered.some(c => c.method === 'getSchedules' && c.tool === 'actual_schedules_get'),
    'a known-covered method (getSchedules) is in the covered bucket');
  assert(internal.includes('init') && internal.includes('shutdown'),
    'known lifecycle methods (init, shutdown) are in the internal bucket');
  assert(!gaps.includes('getSchedules') && !gaps.includes('createTag'),
    'covered methods (getSchedules, createTag) are never in the gaps bucket');
}

// (f) a real gap still surfaces, proven with a synthetic uncovered method.
console.log('\n[synthetic gap detection]');
{
  const SYNTH = '__totally_uncovered_method__';
  const { gaps } = analyzeCoverage({ apiMethodsOverride: [...FROZEN_API_SURFACE, SYNTH] });
  assert(gaps.includes(SYNTH), 'a synthetic uncovered method appears in the gaps bucket');
  assert(!gaps.includes('getAccounts'), 'a covered method does not leak into gaps when a synthetic gap is present');
}

// mapping-integrity check actually fires when the registry lacks a mapped tool.
console.log('\n[mapping-integrity check fires]');
{
  // apiMethodsOverride: [] deliberately. mappingErrors iterates Object.entries(API_TO_TOOL)
  // at list-actual-api-methods.mjs:138 and never reads apiMethods, so it is already
  // fully hermetic; passing a surface at all only ever made it LOOK registry-dependent.
  const { mappingErrors } = analyzeCoverage({ apiMethodsOverride: [], implementedToolsOverride: [] });
  assert(mappingErrors.length === Object.keys(API_TO_TOOL).length,
    'with an empty registry, every mapped method is reported as a mapping error');
}

console.log(`\n[check-coverage] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
