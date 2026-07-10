// tests/unit/residue_pattern.test.js
//
// #280: pins the residue detection contract in tests/manual/residue.js.
//
// The detection has TWO paths, and this test proves the partition is exhaustive:
//   1. Named objects match TEST_OBJECT_RE (machine-generated name shape).
//   2. Rules have NO name; they are matched by a condition value starting
//      RULE_MARKER_PREFIX. Those markers are static and carry no timestamp, so
//      TEST_OBJECT_RE correctly rejects them.
//
// The templates are HARVESTED from tests/manual/tests/*.js rather than hardcoded, so a
// new module that invents a name shape no detector can see fails the build instead of
// leaking residue into the dev budget for months (which is what actually happened).
//
// Run: node tests/unit/residue_pattern.test.js

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { TEST_OBJECT_RE, RULE_MARKER_PREFIX, isTestObjectName, isTestRule } =
  await import('../../tests/manual/residue.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
async function checkAsync(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[residue-pattern]');

// --- the two real timestamp shapes the modules generate -----------------------
const ISO = new Date().toISOString().replace(/[:.]/g, '-'); // account, payee, category, ...
const EPOCH = String(Date.now());                            // schedule.js, notes.js

check('MATCH: ISO-timestamped names, including digit labels and -Updated suffixes', () => {
  for (const n of [
    `MCP-Test-${ISO}`,
    `MCP-Payee2-${ISO}`,        // payee.js:45  (digit in the label)
    `MCP-T3-neg-${ISO}`,        // transaction.js:85
    `MCP-BuRU-Group-${ISO}`,
    `MCP-Group-${ISO}-Updated`,
    `MCP-Test-Del-${ISO}`,
  ]) assert.ok(isTestObjectName(n), `should match: ${n}`);
});

check('MATCH: epoch-timestamped names (schedule.js and notes.js use Date.now())', () => {
  for (const n of [
    `MCP-Schedule-OneOff-${EPOCH}`,
    `MCP-Schedule-Recur-${EPOCH}`,
    `MCP-Note-Test-${EPOCH}`,
    `MCP-AccountNote-${EPOCH}`,
  ]) assert.ok(isTestObjectName(n), `should match: ${n}`);
});

check('REJECT: human names without a timestamp are never swept', () => {
  for (const n of ['MCP-Test', 'MCP-Testing', 'MCP-Budget', 'Household MCP-Test-2026', 'Groceries']) {
    assert.ok(!isTestObjectName(n), `must NOT match: ${n}`);
  }
});

check('REJECT: the static MCP-Rule-* markers (they travel the OTHER detection path)', () => {
  // Loosening the regex to swallow these would start matching human names.
  for (const n of ['MCP-Rule-no-op-test', 'MCP-Rule-test-marker', 'MCP-Rule-updated-marker']) {
    assert.ok(!isTestObjectName(n), `regex must reject the rule marker: ${n}`);
  }
});

check('RULE PATH: isTestRule matches on a condition value, not a name', () => {
  assert.ok(isTestRule({ id: 'r1', conditions: [{ field: 'notes', value: 'MCP-Rule-test-marker' }] }));
  assert.ok(isTestRule({ id: 'r2', conditions: [{ value: 'x' }, { value: 'MCP-Rule-leak-marker' }] }));
  assert.ok(!isTestRule({ id: 'r3', conditions: [{ value: 'Groceries' }] }));
  assert.ok(!isTestRule({ id: 'r4' }), 'a rule with no conditions is not test residue');
  assert.ok(!isTestRule(null));
});

// --- the harvest: reality, not my assumptions --------------------------------
function harvestLiterals() {
  const dir = join(ROOT, 'tests', 'manual', 'tests');
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    // Template literals and plain strings that start with MCP-
    for (const m of src.matchAll(/[`'"](MCP-[^`'"]*)[`'"]/g)) out.push({ file, literal: m[1] });
  }
  return out;
}

/** Replace ${...} interpolations with a concrete timestamp so the shape can be tested. */
function materialise(literal, stamp) {
  return literal.replace(/\$\{[^}]*\}/g, stamp);
}

check('HARVEST: the partition over every MCP-* literal is EXHAUSTIVE', () => {
  const literals = harvestLiterals();
  assert.ok(literals.length > 20, `expected a real harvest, got ${literals.length}`);

  const unclassified = [];
  let nameShaped = 0;
  let ruleMarkers = 0;

  for (const { file, literal } of literals) {
    if (literal.startsWith(RULE_MARKER_PREFIX)) { ruleMarkers++; continue; }

    const interpolated = literal.includes('${');
    if (!interpolated) {
      // A static, non-rule MCP-* literal is a log string or a field value, not an object
      // name. Only names created from a timestamp can become residue.
      continue;
    }
    // The module either interpolates an ISO stamp or an epoch. Both must match.
    const okIso = isTestObjectName(materialise(literal, ISO));
    const okEpoch = isTestObjectName(materialise(literal, EPOCH));
    if (okIso || okEpoch) { nameShaped++; continue; }
    unclassified.push(`${file}: ${literal}`);
  }

  assert.deepStrictEqual(
    unclassified, [],
    `these generated names match NEITHER detection path, so they would leak:\n  ${unclassified.join('\n  ')}`,
  );
  assert.ok(nameShaped >= 25, `expected the name-shape path to cover the templates, got ${nameShaped}`);
  assert.ok(ruleMarkers >= 3, `expected the MCP-Rule-* markers to be harvested, got ${ruleMarkers}`);
  console.log(`     (harvest: ${nameShaped} name-shaped templates, ${ruleMarkers} rule markers)`);
});

check('the regex is anchored (no substring match inside a longer human name)', () => {
  assert.ok(!isTestObjectName(`My MCP-Test-${ISO} account`));
  assert.ok(!isTestObjectName(`MCP-Test-${ISO}!`));
});

await checkAsync('TRANSFER PAYEES are never residue, no matter how test-shaped their name is', async () => {
  // Actual auto-creates one transfer payee per account, named after the account and linked
  // by `transfer_acct`. It is owned by the account, so deleting it breaks transfer linkage.
  // Test accounts are CLOSED rather than deleted, so their transfer payees legitimately
  // persist. A live dry-run caught this pattern about to delete 6 of them.
  const { findResidue } = await import('../../tests/manual/residue.js');
  const stub = async (tool) => {
    switch (tool) {
      case 'actual_accounts_list': return [{ id: 'a1', name: `MCP-Test-${ISO}`, closed: true }];
      case 'actual_payees_get': return [
        { id: 'p1', name: `MCP-Test-${ISO}`, transfer_acct: 'a1' },  // transfer payee: NOT residue
        { id: 'p2', name: `MCP-Payee-${ISO}` },                       // plain payee: residue
        { id: 'p3', name: 'Groceries' },                              // human payee: NOT residue
      ];
      default: return [];
    }
  };
  const r = await findResidue(stub);
  assert.deepStrictEqual(r.payees.map((p) => p.id), ['p2'], 'only the plain test payee is residue');
  assert.strictEqual(r.closedAccounts.length, 1, 'the closed test account is reported, not swept');
  assert.strictEqual(r.openAccounts.length, 0);
});

console.log(`\n[residue-pattern] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
