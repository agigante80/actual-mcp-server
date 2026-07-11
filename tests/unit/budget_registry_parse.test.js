// tests/unit/budget_registry_parse.test.js
//
// parseBudgetRegistry (src/lib/budget-registry.ts) turns the default ACTUAL_* config plus
// any BUDGET_N_* env vars into the multi-budget registry (a documented feature). Only its
// #161 security branch (encryption password over http) was tested; the CORE parsing was
// not, so a regression in the fallbacks, the default-budget entry, the lowercase keying, or
// the numbering-gap behaviour would silently misconfigure multi-budget users. This pins it.
//
// process.exit(1) is the failure signal (missing sync id / #161); we spy on it the same way
// config_insecure_upstream.test.js does, throwing a sentinel so parsing stops like a real exit.
//
// Run: node tests/unit/budget_registry_parse.test.js

import assert from 'node:assert';
import { parseBudgetRegistry, MAX_BUDGET_SCAN } from '../../dist/src/lib/budget-registry.js';

const DEFAULTS = { serverUrl: 'https://actual.example.com', password: 'defpass', syncId: 'default-sync', encryptionPassword: undefined };

// Spy on process.exit: throw a sentinel so control stops (as a real exit would), and record.
class ExitSignal extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
function withExitSpy(fn) {
  const orig = process.exit;
  // Silence the expected `[CONFIG] ...` error diagnostics the exit paths print, so a reader
  // scanning CI logs does not see red-looking stderr next to passing cases. Capture
  // console.warn (#289 numbering-gap warning) so its content can be asserted.
  const origErr = console.error;
  const origWarn = console.warn;
  let exitedCode = null;
  const warns = [];
  process.exit = (code) => { exitedCode = code ?? 0; throw new ExitSignal(exitedCode); };
  console.error = () => {};
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try { const value = fn(); return { value, exitedCode, warns }; }
  catch (e) { if (e instanceof ExitSignal) return { value: undefined, exitedCode, warns }; throw e; }
  finally { process.exit = orig; console.error = origErr; console.warn = origWarn; }
}

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label}: ${err.message}`); failed++; }
}

console.log('\n[budget-registry-parse] parseBudgetRegistry core parsing');

check('default budget only: one entry keyed by "default" (lowercased) with the default config', () => {
  const { value: reg, exitedCode } = withExitSpy(() => parseBudgetRegistry({}, DEFAULTS));
  assert.strictEqual(exitedCode, null, 'no exit on the happy path');
  assert.strictEqual(reg.size, 1);
  assert.ok(reg.has('default'), 'keyed by lowercased "Default"');
  assert.deepStrictEqual(reg.get('default'), {
    name: 'Default', serverUrl: DEFAULTS.serverUrl, password: DEFAULTS.password, syncId: DEFAULTS.syncId, encryptionPassword: undefined,
  });
});

check('BUDGET_DEFAULT_NAME renames the default entry (key is lowercased)', () => {
  const { value: reg } = withExitSpy(() => parseBudgetRegistry({ BUDGET_DEFAULT_NAME: 'Household' }, DEFAULTS));
  assert.ok(reg.has('household'), 'keyed by lowercased custom name');
  assert.strictEqual(reg.get('household').name, 'Household', 'display name preserves case');
});

check('an extra budget with all fields is registered alongside the default', () => {
  const env = {
    BUDGET_1_NAME: 'Business', BUDGET_1_SYNC_ID: 'biz-sync',
    BUDGET_1_SERVER_URL: 'https://biz.example.com', BUDGET_1_PASSWORD: 'bizpass', BUDGET_1_ENCRYPTION_PASSWORD: 'bizenc',
  };
  const { value: reg } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 2);
  assert.deepStrictEqual(reg.get('business'), {
    name: 'Business', serverUrl: 'https://biz.example.com', password: 'bizpass', syncId: 'biz-sync', encryptionPassword: 'bizenc',
  });
});

check('an extra budget falls back to the default serverUrl/password when they are omitted', () => {
  const { value: reg } = withExitSpy(() => parseBudgetRegistry({ BUDGET_1_NAME: 'Savings', BUDGET_1_SYNC_ID: 'sav-sync' }, DEFAULTS));
  const b = reg.get('savings');
  assert.strictEqual(b.serverUrl, DEFAULTS.serverUrl, 'serverUrl falls back to default');
  assert.strictEqual(b.password, DEFAULTS.password, 'password falls back to default');
  assert.strictEqual(b.syncId, 'sav-sync');
});

check('multiple sequential extra budgets are all registered', () => {
  const env = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    BUDGET_2_NAME: 'Two', BUDGET_2_SYNC_ID: 's2',
  };
  const { value: reg } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 3, 'default + two');
  assert.ok(reg.has('one') && reg.has('two'));
});

check('a gap in the numbering still drops later budgets (load UNCHANGED) but now WARNS about it (#289)', () => {
  const env = {
    BUDGET_1_NAME: 'First', BUDGET_1_SYNC_ID: 's1',
    // BUDGET_2_* deliberately absent
    BUDGET_3_NAME: 'Third', BUDGET_3_SYNC_ID: 's3', BUDGET_3_PASSWORD: 'topsecret', BUDGET_3_ENCRYPTION_PASSWORD: 'enc-secret',
  };
  const { value: reg, warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  // Load behaviour is unchanged (backward compatible).
  assert.strictEqual(reg.size, 2, 'default + First only; Third is never reached');
  assert.ok(reg.has('first') && !reg.has('third'), 'Third dropped by the numbering gap');
  // #289: exactly one warning naming the missing index, the ignored index, and IGNORED.
  assert.strictEqual(warns.length, 1, 'exactly one warning');
  const w = warns[0];
  assert.ok(w.includes('BUDGET_2'), 'names the missing index');
  assert.ok(w.includes('BUDGET_3'), 'names the ignored index');
  assert.ok(w.includes('IGNORED'), 'says IGNORED');
  // Must not leak any secret value in the diagnostic.
  assert.ok(!w.includes('topsecret') && !w.includes('enc-secret'), 'no password/encryption value in the warning');
});

check('a gap at BUDGET_1 (extras start at BUDGET_2) warns without a nonsensical "BUDGET_0"', () => {
  const env = { BUDGET_2_NAME: 'Two', BUDGET_2_SYNC_ID: 's2' }; // no BUDGET_1
  const { value: reg, warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 1, 'only the default loads; BUDGET_2 is orphaned by the missing BUDGET_1');
  assert.strictEqual(warns.length, 1);
  assert.ok(warns[0].includes('BUDGET_1') && warns[0].includes('BUDGET_2') && warns[0].includes('IGNORED'));
  assert.ok(!warns[0].includes('BUDGET_0'), 'no nonsensical BUDGET_0 in the message');
});

check('consecutive budgets emit NO gap warning (no false positive)', () => {
  const env = { BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1', BUDGET_2_NAME: 'Two', BUDGET_2_SYNC_ID: 's2' };
  const { value: reg, warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 3, 'default + two loaded');
  assert.strictEqual(warns.length, 0, 'no warning when the numbering is contiguous');
});

check('multiple orphaned indices are listed in a SINGLE warning', () => {
  const env = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    // BUDGET_2 absent
    BUDGET_3_NAME: 'Three', BUDGET_3_SYNC_ID: 's3',
    BUDGET_7_NAME: 'Seven', BUDGET_7_SYNC_ID: 's7',
  };
  const { warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(warns.length, 1, 'one warning, not one per gap');
  assert.ok(warns[0].includes('BUDGET_3') && warns[0].includes('BUDGET_7'), 'lists both orphaned indices');
});

check('the gap scan is bounded by MAX_BUDGET_SCAN: an orphan at the ceiling warns, one just beyond does not', () => {
  const atCeiling = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    [`BUDGET_${MAX_BUDGET_SCAN}_NAME`]: 'Edge', [`BUDGET_${MAX_BUDGET_SCAN}_SYNC_ID`]: 'se',
  };
  const { warns: inRange } = withExitSpy(() => parseBudgetRegistry(atCeiling, DEFAULTS));
  assert.strictEqual(inRange.length, 1, `an orphan at BUDGET_${MAX_BUDGET_SCAN} is detected`);

  const beyond = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    [`BUDGET_${MAX_BUDGET_SCAN + 1}_NAME`]: 'Over', [`BUDGET_${MAX_BUDGET_SCAN + 1}_SYNC_ID`]: 'so',
  };
  const { warns: outOfRange } = withExitSpy(() => parseBudgetRegistry(beyond, DEFAULTS));
  assert.strictEqual(outOfRange.length, 0, `the scan does not iterate past BUDGET_${MAX_BUDGET_SCAN} (bounded)`);
});

check('a BUDGET_N_NAME with no BUDGET_N_SYNC_ID exits(1)', () => {
  const { exitedCode } = withExitSpy(() => parseBudgetRegistry({ BUDGET_1_NAME: 'NoSync' }, DEFAULTS));
  assert.strictEqual(exitedCode, 1, 'missing sync id is a fatal config error');
});

check('#161: an extra budget with an encryption password over http:// exits(1) unless overridden', () => {
  const env = { BUDGET_1_NAME: 'Enc', BUDGET_1_SYNC_ID: 's1', BUDGET_1_SERVER_URL: 'http://lan.local', BUDGET_1_ENCRYPTION_PASSWORD: 'secret' };
  const { exitedCode } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(exitedCode, 1, 'refuses encryption password over plaintext upstream');
  const { exitedCode: allowed } = withExitSpy(() => parseBudgetRegistry({ ...env, ALLOW_INSECURE_UPSTREAM: 'true' }, DEFAULTS));
  assert.strictEqual(allowed, null, 'ALLOW_INSECURE_UPSTREAM=true overrides');
});

console.log(`\n[budget-registry-parse] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
