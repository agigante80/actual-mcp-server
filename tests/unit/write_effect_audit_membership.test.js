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
// That is #321, and it must never gate a build. THIS test reads two files in this repository
// plus the COMPILED classification in dist/ (#379 replaced the private READ_ONLY list with
// the annotations the server publishes, so "can this tool write?" has one answer). Its
// result therefore cannot change without a commit here, but it does require a build: every
// path that runs it builds first (the documented pre-commit sequence, CI's Run Tests job,
// and the tool-authoring checklist). It belongs in test:unit-js; the staleness reminder
// does not.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? '\n      ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const manager = read('../../src/actualToolsManager.ts');
const audit = read('../../docs/audit/write-effect-audit.md');

// IMPLEMENTED_TOOLS is the canonical registry. Take the tool names from it rather than from
// the filesystem, so a tool that exists but is not registered cannot slip through either.
// [A-Za-z0-9_], NOT [a-z0-9_]. The first version of this test omitted A-Z and therefore
// could not see a single camelCase tool: actual_budgets_setAmount,
// actual_budgets_holdForNextMonth, actual_budgets_setCarryover, actual_budgets_resetHold,
// actual_budgets_getMonth and actual_budgets_getMonths were all invisible, four of them
// writes. A guard against silent gaps that has a silent gap is worse than none.
const tools = [...new Set([...manager.matchAll(/'(actual_[A-Za-z0-9_]+)'/g)].map((m) => m[1]))];

/**
 * A PINNED list of the read-only tools, deliberately not a naming heuristic.
 *
 * A regex over the tool name would silently misclassify anything named unusually, which is
 * the same failure mode this test exists to prevent.
 *
 * #379 RETIRED the hand-maintained READ_ONLY set that used to live here. The classification
 * now comes from `src/lib/tool-annotations.ts`, which is the same data the server PUBLISHES
 * to clients as MCP `readOnlyHint`, and which `tests/unit/tool_annotations.test.js` verifies
 * against the adapter call graph. So the question "can this tool write?" has one answer,
 * checked mechanically, instead of a private list here that only a human could keep true.
 *
 * The property this test guards is unchanged: a tool that can write must appear in the
 * audit. A new write tool that nobody classified still fails, now without any list to
 * forget to update.
 */

console.log('\n[#370] write-effect audit membership');

// Pinned against the registry itself rather than a loose floor: `> 50` passed happily at 68
// when the answer was 74, which is exactly how the missing A-Z went unnoticed.
const declared = (manager.match(/^\s*'actual_[A-Za-z0-9_]+',?\s*$/gm) || []).length;
check(
  tools.length === declared && declared > 0,
  `every IMPLEMENTED_TOOLS entry was parsed (${tools.length} of ${declared})`,
  tools.length === declared ? '' : 'the tool-name regex is not seeing every declared entry',
);

const writeTools = tools.filter((t) => !annotationsFor(t).readOnlyHint);
// Backticked match, not a substring: `actual_rules_create` is a prefix of
// `actual_rules_create_or_update`, so `includes` would report the shorter one as audited
// whenever only the longer one is present.
//
// #386: the name must be in a TABLE ROW, not merely somewhere in the file. This used to scan the
// whole document, so a new write tool satisfied the gate by being appended to the UNKNOWN prose
// comma-list: no row, no verdict, no evidence. A tool parked that way was then invisible forever,
// because nothing ages a prose list out and nothing counts it. Requiring a row makes the cheapest
// way to satisfy the gate also the way that records a disposition, which is why option 1 was
// preferred over capping the size of UNKNOWN or dating its entries: those police the symptom,
// this removes the cheap path. The UNKNOWN prose was converted to a table in the same change.
//
// Backticked match, not a substring: `actual_rules_create` is a prefix of
// `actual_rules_create_or_update`, so `includes` would report the shorter one as audited
// whenever only the longer one is present.
const rowLines = audit.split('\n').filter((l) => l.trimStart().startsWith('|'));
const auditMentions = new Set(
  rowLines.flatMap((l) => [...l.matchAll(/`(actual_[A-Za-z0-9_]+)`/g)].map((m) => m[1])),
);
const missing = writeTools.filter((t) => !auditMentions.has(t));
check(
  missing.length === 0,
  `every write tool appears in docs/audit/write-effect-audit.md (${writeTools.length} checked)`,
  missing.length
    ? `absent from the audit TABLES: ${missing.join(', ')}\n      Add a ROW (CONFIRMED / SAFE / UNKNOWN). Naming it in prose no longer counts (#386).\n      Or classify it read-only in src/lib/tool-annotations.ts if it cannot write.`
    : '',
);

// The reverse direction: a tool retired from the registry should not linger in the audit as
// though it were still part of the surface.
// Rows only, for the same reason: a retired tool discussed in a narrative paragraph is history,
// not a claim that it is still part of the surface.
const auditedNames = [...auditMentions];
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
