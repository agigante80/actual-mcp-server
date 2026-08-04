// tests/unit/api_surface_drift.test.js
//
// #321: hermetic tests of the drift lane's pure decision functions. No network,
// no registry read. classify() takes apiToTool and liveSurface as INJECTED
// arguments precisely so this file never has to enumerate the live surface,
// which is the thing the whole ticket exists to get out of the unit suite.

import assert from 'node:assert';
import {
  classify,
  validateMethodName,
  validateBaseline,
  filingPlan,
  buildGapBody,
  gapSentinel,
  MAX_FILES_PER_RUN,
} from '../../scripts/api-surface-drift.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const baseline = (accepted = {}, maxAccepted = 10) => ({ maxAccepted, accepted });
const entry = (over = {}) => ({ reason: 'r', issue: 1, apiVersion: '26.8.0', firstSeen: '2026-08-04', ...over });

// --- condition 1: a new uncovered method ------------------------------------

check('condition 1: an unaccepted gap is red and files', () => {
  const r = classify({ gaps: ['exportBudget'], liveSurface: ['exportBudget'], baseline: baseline() });
  assert.strictEqual(r.red, true);
  assert.deepStrictEqual(r.newGaps, ['exportBudget']);
});

check('condition 1: an ACCEPTED gap is not red', () => {
  const r = classify({
    gaps: ['exportBudget'], liveSurface: ['exportBudget'],
    baseline: baseline({ exportBudget: entry() }),
  });
  assert.strictEqual(r.red, false);
  assert.deepStrictEqual(r.newGaps, []);
});

// --- condition 2: stale baseline --------------------------------------------

check('condition 2: a baselined method that is now COVERED is stale', () => {
  // Accepted, still exported, but no longer in gaps: someone shipped a tool and
  // forgot to clear the entry. Red, no filing.
  const r = classify({ gaps: [], liveSurface: ['exportBudget'], baseline: baseline({ exportBudget: entry() }) });
  assert.strictEqual(r.red, true);
  assert.deepStrictEqual(r.staleBaseline, ['exportBudget']);
  assert.deepStrictEqual(r.newGaps, []);
});

check('condition 2: a baselined method no longer EXPORTED is stale', () => {
  const r = classify({ gaps: ['gone'], liveSurface: [], baseline: baseline({ gone: entry() }) });
  assert.strictEqual(r.red, true);
  assert.deepStrictEqual(r.staleBaseline, ['gone']);
});

// --- condition 3: the dangerous direction -----------------------------------

check('condition 3: a covered method removed upstream is red and files P1', () => {
  // The direction the first ticket revision missed entirely. A shipped tool now
  // calls a method that does not exist, which fails in a user's budget.
  const r = classify({
    apiToTool: { getSchedules: 'actual_schedules_get' },
    liveSurface: [],
    gaps: [],
    baseline: baseline(),
  });
  assert.strictEqual(r.red, true);
  assert.deepStrictEqual(r.removedCovered, [{ method: 'getSchedules', tool: 'actual_schedules_get' }]);
});

check('condition 3: a mapped method still exported is NOT flagged', () => {
  const r = classify({
    apiToTool: { getSchedules: 'actual_schedules_get' },
    liveSurface: ['getSchedules'],
    gaps: [],
    baseline: baseline(),
  });
  assert.strictEqual(r.red, false);
  assert.deepStrictEqual(r.removedCovered, []);
});

// --- condition 4: debt cap ---------------------------------------------------

check('condition 4: exceeding maxAccepted is red without filing', () => {
  const accepted = Object.fromEntries(['a', 'b', 'c'].map((m) => [m, entry()]));
  const r = classify({ gaps: ['a', 'b', 'c'], liveSurface: ['a', 'b', 'c'], baseline: baseline(accepted, 2) });
  assert.strictEqual(r.capExceeded, true);
  assert.strictEqual(r.red, true);
  assert.deepStrictEqual(r.newGaps, [], 'accepted gaps still do not file');
});

check('condition 4: at the cap exactly is not exceeded', () => {
  const accepted = Object.fromEntries(['a', 'b'].map((m) => [m, entry()]));
  const r = classify({ gaps: ['a', 'b'], liveSurface: ['a', 'b'], baseline: baseline(accepted, 2) });
  assert.strictEqual(r.capExceeded, false);
  assert.strictEqual(r.red, false);
});

check('a clean surface is not red', () => {
  const r = classify({
    apiToTool: { getSchedules: 'actual_schedules_get' },
    liveSurface: ['getSchedules'], gaps: [], baseline: baseline(),
  });
  assert.strictEqual(r.red, false);
});

// --- registry-controlled names ----------------------------------------------

check('method-name validation accepts ordinary identifiers', () => {
  for (const n of ['exportBudget', 'getPreferences', '_x', '$y', 'a1']) {
    assert.strictEqual(validateMethodName(n), true, n);
  }
});

check('method-name validation rejects injection shapes', () => {
  // Gap names come from Object.keys() over a third-party module namespace. They
  // are arbitrary strings chosen by someone else, and this mechanism is permanent.
  for (const n of ['a b', 'a\nb', '`whoami`', '${{ secrets.APP_PRIVATE_KEY }}', '<!-- api-gap:x -->', '', 'a'.repeat(65), null, undefined, 42]) {
    assert.strictEqual(validateMethodName(n), false, JSON.stringify(n));
  }
});

check('a name that fails validation is REJECTED, never filed', () => {
  const r = classify({ gaps: ['ok', 'bad name'], liveSurface: ['ok', 'bad name'], baseline: baseline() });
  const plan = filingPlan(r);
  assert.deepStrictEqual(plan.toFile.map((x) => x.method), ['ok']);
  assert.deepStrictEqual(plan.rejected, ['bad name']);
});

check('a poisoned name cannot reach the issue body', () => {
  const body = buildGapBody({ method: 'a\nb', kind: 'gap', apiVersion: '26.8.0', runUrl: 'u' });
  assert.ok(body.includes('(name failed validation)'));
  assert.ok(!body.includes('a\nb'));
});

// --- filing volume and dedupe -----------------------------------------------

check('per-run filing volume is capped, and overflow is reported', () => {
  const gaps = Array.from({ length: 8 }, (_, i) => `m${i}`);
  const r = classify({ gaps, liveSurface: gaps, baseline: baseline() });
  const plan = filingPlan(r);
  assert.strictEqual(plan.toFile.length, MAX_FILES_PER_RUN);
  assert.strictEqual(plan.overflow, 8 - MAX_FILES_PER_RUN);
});

check('an already-filed method is not re-filed', () => {
  const r = classify({ gaps: ['a', 'b'], liveSurface: ['a', 'b'], baseline: baseline() });
  const plan = filingPlan(r, { alreadyFiled: new Set(['a']) });
  assert.deepStrictEqual(plan.toFile.map((x) => x.method), ['b']);
});

check('the body carries a sentinel that the dedupe query can find', () => {
  const body = buildGapBody({ method: 'exportBudget', kind: 'gap', apiVersion: '26.8.0', runUrl: 'u' });
  assert.ok(body.includes(gapSentinel('exportBudget')));
  const re = /<!-- api-gap:([A-Za-z_$][A-Za-z0-9_$]{0,63}) -->/;
  assert.strictEqual(re.exec(body)[1], 'exportBudget', 'the sentinel must round-trip through the dedupe regex');
});

// --- baseline schema ---------------------------------------------------------

check('a valid baseline passes', () => {
  assert.deepStrictEqual(validateBaseline({ maxAccepted: 10, accepted: { a: entry() } }), []);
});

check('an empty baseline passes', () => {
  assert.deepStrictEqual(validateBaseline({ maxAccepted: 10, accepted: {} }), []);
});

check('NEGATIVE: every baseline field is actually checked', () => {
  const bad = (over) => validateBaseline({ maxAccepted: 10, accepted: { a: entry(over) } });
  assert.ok(bad({ reason: '' }).some((p) => /reason/.test(p)), 'blank reason must fail');
  assert.ok(bad({ reason: '  ' }).some((p) => /reason/.test(p)), 'whitespace reason must fail');
  assert.ok(bad({ issue: -1 }).some((p) => /issue/.test(p)), 'negative issue must fail');
  assert.ok(bad({ issue: 1.5 }).some((p) => /issue/.test(p)), 'non-integer issue must fail');
  assert.ok(bad({ apiVersion: '' }).some((p) => /apiVersion/.test(p)), 'blank apiVersion must fail');
  assert.ok(bad({ firstSeen: '4 Aug 2026' }).some((p) => /firstSeen/.test(p)), 'non-ISO firstSeen must fail');
  assert.ok(validateBaseline({ maxAccepted: -1, accepted: {} }).some((p) => /maxAccepted/.test(p)));
  assert.ok(validateBaseline({ maxAccepted: 10, accepted: [] }).some((p) => /accepted/.test(p)), 'an array is not a keyed dict');
  assert.ok(validateBaseline(null).length > 0);
});

check('NEGATIVE: a baseline key that is not a valid method name fails', () => {
  // Otherwise a hand-edited baseline becomes a second unsanitised path into an
  // issue body.
  assert.ok(validateBaseline({ maxAccepted: 10, accepted: { 'bad name': entry() } })
    .some((p) => /valid method name/.test(p)));
});

check('issue 0 is legal (not yet filed) but negative is not', () => {
  assert.deepStrictEqual(validateBaseline({ maxAccepted: 10, accepted: { a: entry({ issue: 0 }) } }), []);
});

console.log(`\n[api-surface-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
