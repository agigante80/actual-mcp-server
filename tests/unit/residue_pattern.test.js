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
import { viaCompact } from './helpers/compact-call-tool.js';

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
  assert.ok(isTestRule({ id: '00000000-0000-4000-8000-0000000000f1', conditions: [{ field: 'notes', value: 'MCP-Rule-test-marker' }] }));
  assert.ok(isTestRule({ id: '00000000-0000-4000-8000-0000000000f2', conditions: [{ value: 'x' }, { value: 'MCP-Rule-leak-marker' }] }));
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

// --- #576: the step 9 harness scripts reuse the MCP-<...>-<13 digits> shape ------------
check('MATCH (#576): MCP-REG270/MCP-DIAG270 harness names with a run id', () => {
  for (const n of [`MCP-REG270-baseline-${EPOCH}`, `MCP-REG270-grp-${EPOCH}`, `MCP-DIAG270-mid-${EPOCH}`]) {
    assert.ok(isTestObjectName(n), `should match: ${n}`);
  }
});

check('REJECT (#576): REG270 names that are not ours are never swept', () => {
  // The legacy pid-suffixed names (removed once by hand) and human names stay invisible:
  // the sweep regex was NOT loosened for this ticket.
  for (const n of ['REG270 budget', 'REG270-baseline', 'REG270-baseline-12345', `REG270-baseline-${EPOCH}`, 'MCP-REG270-baseline-12345']) {
    assert.ok(!isTestObjectName(n), `must NOT match: ${n}`);
  }
});

await checkAsync('HARVEST (#576): every name the step 9 scripts generate matches the sweep AND the per-run cleanup', async () => {
  const { ownNameRe } = await import('../../scripts/lib/harness-cleanup.mjs');
  let seen = 0;
  for (const [file, prefix] of [['regression-270-stall.mjs', 'MCP-REG270'], ['diag-270-http.mjs', 'MCP-DIAG270']]) {
    const src = readFileSync(join(ROOT, 'scripts', file), 'utf8');
    // Any REG270/DIAG270 template literal (one interpolating a value), prefixed or not, so
    // a regression to the old shape is seen. Backticked prose in comments has no `${`.
    for (const m of src.matchAll(/`((?:MCP-)?(?:REG|DIAG)270-[^`]*\$\{[^`]*)`/g)) {
      const name = m[1].replace(/\$\{RUN_ID\}/g, EPOCH).replace(/\$\{[^}]*\}/g, 'label');
      assert.ok(isTestObjectName(name), `${file}: ${m[1]} -> ${name} is invisible to the pre-run sweep`);
      assert.ok(ownNameRe(prefix, EPOCH).test(name), `${file}: ${m[1]} -> ${name} is invisible to the run's own cleanup`);
      seen++;
    }
  }
  assert.ok(seen >= 4, `expected the harness templates to be harvested, got ${seen}`);
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
  const stub = viaCompact(async (tool) => {
    switch (tool) {
      case 'actual_accounts_list': return [{ id: '00000000-0000-4000-8000-0000000000a1', name: `MCP-Test-${ISO}`, closed: true }];
      case 'actual_payees_get': return [
        { id: '00000000-0000-4000-8000-0000000000b1', name: `MCP-Test-${ISO}`, transfer_acct: '00000000-0000-4000-8000-0000000000a1' },  // transfer payee: NOT residue
        { id: '00000000-0000-4000-8000-0000000000b2', name: `MCP-Payee-${ISO}` },                       // plain payee: residue
        { id: '00000000-0000-4000-8000-0000000000b3', name: 'Groceries' },                              // human payee: NOT residue
      ];
      default: return [];
    }
  });
  const r = await findResidue(stub);
  assert.deepStrictEqual(r.payees.map((p) => p.id), ['00000000-0000-4000-8000-0000000000b2'], 'only the plain test payee is residue');
  assert.strictEqual(r.closedAccounts.length, 1, 'the closed test account is reported, not swept');
  assert.strictEqual(r.openAccounts.length, 0);
});

// #584: three legacy listing tools return their array under their own key, and the test clients
// pass that through. The rows above all stub bare arrays, a shape the live server never sends
// for these three, which is how the blind spot survived. These rows use the LIVE shapes.
const LIVE_LEAKS = {
  actual_category_groups_get: { groups: [{ id: '00000000-0000-4000-8000-0000000000e1', name: 'MCP-Leak-1761000000000' }] },
  actual_rules_get: { rules: [{ id: '00000000-0000-4000-8000-0000000000f1', conditions: [{ value: 'MCP-Rule-x' }] }] },
  actual_schedules_get: { schedules: [{ id: '00000000-0000-4000-8000-0000000000a5', name: 'MCP-Schedule-1761000000000' }], count: 1 },
};
const stubFrom = (map) => viaCompact(async (tool) => (tool in map ? map[tool] : []));
async function quietly(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { return { value: await fn(), out: lines.join('\n') }; } finally { console.log = orig; }
}

await checkAsync('#584: a leaked group, rule and schedule in their LIVE shapes are counted and named', async () => {
  const { assertNoResidue } = await import('../../tests/manual/residue.js');
  const { value, out } = await quietly(() => assertNoResidue(stubFrom(LIVE_LEAKS)));
  assert.strictEqual(value, 3, `expected 3 residue objects, got ${value}`);
  for (const name of ['MCP-Leak-1761000000000', 'MCP-Schedule-1761000000000', '00000000-0000-4000-8000-0000000000f1']) {
    assert.ok(out.includes(name), `the failure listing must name ${name}, got:\n${out}`);
  }
});

await checkAsync('#584: human objects in the same live shapes are never counted', async () => {
  const { assertNoResidue } = await import('../../tests/manual/residue.js');
  const { value } = await quietly(() => assertNoResidue(stubFrom({
    actual_category_groups_get: { groups: [{ id: '00000000-0000-4000-8000-0000000000e2', name: 'Bills' }] },
    actual_rules_get: { rules: [{ id: '00000000-0000-4000-8000-0000000000f2', conditions: [{ value: 'Amazon' }] }] },
    actual_schedules_get: { schedules: [{ id: '00000000-0000-4000-8000-0000000000a6', name: 'Rent' }], count: 1 },
  })));
  assert.strictEqual(value, 0);
});

await checkAsync('#584: the existing `result` and bare-array shapes still count', async () => {
  const { assertNoResidue } = await import('../../tests/manual/residue.js');
  const { value } = await quietly(() => assertNoResidue(stubFrom({
    actual_payees_get: { result: [{ id: '00000000-0000-4000-8000-0000000000b1', name: 'MCP-Payee-1761000000000' }] },
    actual_categories_get: [{ id: '00000000-0000-4000-8000-0000000000d1', name: 'MCP-Cat-1761000000000' }],
  })));
  assert.strictEqual(value, 2);
});

await checkAsync('#584: a listing key is read only from the tool that returns it', async () => {
  const { findResidue, residueCount } = await import('../../tests/manual/residue.js');
  const { value } = await quietly(() => findResidue(stubFrom({
    actual_rules_get: LIVE_LEAKS.actual_rules_get,
    // `rules` from the payees tool is not a payee listing; reading it would count a phantom.
    // Since #583 it is reported unreadable instead (assertNoResidue then refuses to certify).
    actual_payees_get: { rules: [{ id: 'x', name: 'MCP-Payee-1761000000000' }] },
  })));
  assert.strictEqual(residueCount(value), 1, 'only the rule counts');
  assert.deepStrictEqual(value.payees, [], 'no phantom payee');
  assert.deepStrictEqual(value.unreadable, ['list_entities type payee']);
});

console.log(`\n[residue-pattern] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
