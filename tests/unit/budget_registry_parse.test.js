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
import { parseBudgetRegistry } from '../../dist/src/lib/budget-registry.js';

const DEFAULTS = { serverUrl: 'https://actual.example.com', password: 'defpass', syncId: 'default-sync', encryptionPassword: undefined };

// Spy on process.exit: throw a sentinel so control stops (as a real exit would), and record.
class ExitSignal extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
function withExitSpy(fn) {
  const orig = process.exit;
  // Silence the expected `[CONFIG] ...` diagnostics the exit paths print, so a reader
  // scanning CI logs does not see red-looking stderr next to passing cases.
  const origErr = console.error;
  let exitedCode = null;
  process.exit = (code) => { exitedCode = code ?? 0; throw new ExitSignal(exitedCode); };
  console.error = () => {};
  try { const value = fn(); return { value, exitedCode }; }
  catch (e) { if (e instanceof ExitSignal) return { value: undefined, exitedCode }; throw e; }
  finally { process.exit = orig; console.error = origErr; }
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

check('a gap in the numbering stops iteration: BUDGET_1 set, BUDGET_2 missing, BUDGET_3 is silently unreachable', () => {
  const env = {
    BUDGET_1_NAME: 'First', BUDGET_1_SYNC_ID: 's1',
    // BUDGET_2_* deliberately absent
    BUDGET_3_NAME: 'Third', BUDGET_3_SYNC_ID: 's3',
  };
  const { value: reg } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 2, 'default + First only; Third is never reached');
  assert.ok(reg.has('first') && !reg.has('third'), 'Third dropped by the numbering gap');
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
