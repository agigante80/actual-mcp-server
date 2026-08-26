// tests/unit/write_effect_audit_membership.test.js
// #370: a new write tool must not be able to go silently unaudited.
//
// docs/audit/write-effect-audit.md answers "which write tools can report success for an
// upstream call that did nothing". Its own opening argues that a table which quietly omits a
// case reads as coverage and is worse than no table, and it was already incomplete on the
// day it landed: actual_accounts_create and actual_schedules_create appeared in no row.
//
// WHY THIS ONE IS SAFE TO BLOCK, WHEN THE STALENESS REMINDER IS NOT.
// scripts/check-write-effect-audit.mjs compares the audited @actual-app/api version with the
// installed one, so its result changes when UPSTREAM moves and no commit here caused it.
// That is #321, and it must never gate a build. THIS test only reads two files in this
// repository, so its result cannot change without a commit here. It belongs in
// test:unit-js; the staleness reminder does not.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? '\n      ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const manager = read('../../src/actualToolsManager.ts');
const audit = read('../../docs/audit/write-effect-audit.md');

// IMPLEMENTED_TOOLS is the canonical registry. Take the tool names from it rather than from
// the filesystem, so a tool that exists but is not registered cannot slip through either.
const tools = [...new Set([...manager.matchAll(/'(actual_[a-z0-9_]+)'/g)].map((m) => m[1]))];

/**
 * A PINNED list of the read-only tools, deliberately not a naming heuristic.
 *
 * A regex over the tool name would silently misclassify anything named unusually, which is
 * the same failure mode this test exists to prevent. Adding a tool here is a deliberate
 * statement that it cannot write. If a new tool is neither listed here nor present in the
 * audit, this test fails and someone has to make that call explicitly. That is the point:
 * ten seconds of typing, versus a write tool nobody ever audited.
 */
const READ_ONLY = new Set([
  'actual_accounts_list', 'actual_accounts_get_balance',
  'actual_budgets_get_all', 'actual_budgets_getMonth', 'actual_budgets_getMonths',
  'actual_budgets_list_available',
  'actual_categories_get', 'actual_category_groups_get',
  'actual_payees_get', 'actual_payees_common_list', 'actual_payee_rules_get',
  'actual_rules_get', 'actual_schedules_get', 'actual_tags_list',
  'actual_notes_get', 'actual_preferences_get',
  'actual_transactions_get', 'actual_transactions_filter',
  'actual_transactions_search_by_amount', 'actual_transactions_search_by_category',
  'actual_transactions_search_by_month', 'actual_transactions_search_by_payee',
  'actual_transactions_summary_by_category', 'actual_transactions_summary_by_payee',
  'actual_transactions_uncategorized',
  'actual_entities_search', 'actual_get_id_by_name',
  'actual_server_info', 'actual_server_get_version', 'actual_session_list',
]);

console.log('\n[#370] write-effect audit membership');

check(tools.length > 50, `IMPLEMENTED_TOOLS parsed (${tools.length} tools)`);

const writeTools = tools.filter((t) => !READ_ONLY.has(t));
const missing = writeTools.filter((t) => !audit.includes(t));
check(
  missing.length === 0,
  `every write tool appears in docs/audit/write-effect-audit.md (${writeTools.length} checked)`,
  missing.length
    ? `absent from the audit: ${missing.join(', ')}\n      Add a row (CONFIRMED / SAFE / UNKNOWN), or add it to READ_ONLY in this test if it cannot write.`
    : '',
);

// The reverse direction: a tool retired from the registry should not linger in the audit as
// though it were still part of the surface.
const auditedNames = [...new Set([...audit.matchAll(/`(actual_[a-z0-9_]+)`/g)].map((m) => m[1]))];
const stale = auditedNames.filter((t) => !tools.includes(t));
check(
  stale.length === 0,
  'the audit names no tool that has left IMPLEMENTED_TOOLS',
  stale.length ? `named in the audit but not registered: ${stale.join(', ')}` : '',
);

// The marker the staleness reminder reads has to stay machine-readable.
check(
  /<!--\s*audited-api-version:\s*\d+\.\d+\.\d+\s*-->/.test(audit),
  'the audit still carries a machine-readable audited-api-version marker',
);

console.log('');
if (failures === 0) console.log('[#370] Write-effect audit membership holds ✓');
else { console.error(`[#370] ${failures} check(s) FAILED`); process.exit(2); }
