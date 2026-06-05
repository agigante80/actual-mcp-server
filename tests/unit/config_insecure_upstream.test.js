// tests/unit/config_insecure_upstream.test.js
//
// #161 (CWE-319): refuse to send the E2E budget encryption password over a
// plaintext http:// upstream. Covered at two layers:
//   - the default budget, via configSchema.safeParse;
//   - extra budgets, via parseBudgetRegistry (which calls process.exit(1) on a
//     violation, so we spy on process.exit).
// ALLOW_INSECURE_UPSTREAM=true is the explicit override for trusted networks.
//
// Run: node tests/unit/config_insecure_upstream.test.js

import assert from 'assert';

const { configSchema } = await import('../../dist/src/config.js');
const { parseBudgetRegistry } = await import('../../dist/src/lib/budget-registry.js');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const base = { ACTUAL_PASSWORD: 'pw', ACTUAL_BUDGET_SYNC_ID: 'sync-1' };

console.log('\n[config-insecure-upstream] default budget (configSchema)');

check('no encryption password + http upstream: valid', () => {
  assert.strictEqual(configSchema.safeParse({ ...base, ACTUAL_SERVER_URL: 'http://actual:5006' }).success, true);
});
check('encryption password + https upstream: valid', () => {
  assert.strictEqual(configSchema.safeParse({ ...base, ACTUAL_SERVER_URL: 'https://actual:5006', ACTUAL_BUDGET_PASSWORD: 'e2e' }).success, true);
});
check('encryption password + http upstream: REJECTED', () => {
  const r = configSchema.safeParse({ ...base, ACTUAL_SERVER_URL: 'http://actual:5006', ACTUAL_BUDGET_PASSWORD: 'e2e' });
  assert.strictEqual(r.success, false);
  assert.match(JSON.stringify(r.error.issues), /must not be sent over an http/);
});
check('encryption password + http + ALLOW_INSECURE_UPSTREAM=true: valid (override)', () => {
  const r = configSchema.safeParse({ ...base, ACTUAL_SERVER_URL: 'http://actual:5006', ACTUAL_BUDGET_PASSWORD: 'e2e', ALLOW_INSECURE_UPSTREAM: 'true' });
  assert.strictEqual(r.success, true);
});
check('encryption password + http + ALLOW_INSECURE_UPSTREAM=false: REJECTED', () => {
  const r = configSchema.safeParse({ ...base, ACTUAL_SERVER_URL: 'http://actual:5006', ACTUAL_BUDGET_PASSWORD: 'e2e', ALLOW_INSECURE_UPSTREAM: 'false' });
  assert.strictEqual(r.success, false);
});

console.log('\n[config-insecure-upstream] extra budgets (parseBudgetRegistry)');

// parseBudgetRegistry calls process.exit(1) on a violation; spy on it.
function runRegistry(env, defaults) {
  const realExit = process.exit;
  let exited = null;
  process.exit = (code) => { exited = code; throw new Error('__exit__'); };
  try { parseBudgetRegistry(env, defaults); return { exited }; }
  catch (e) { if (e.message === '__exit__') return { exited }; throw e; }
  finally { process.exit = realExit; }
}
const httpsDefaults = { serverUrl: 'https://actual:5006', password: 'pw', syncId: 'sync-1' };

check('extra budget with encryption password over https inherited default: ok', () => {
  const { exited } = runRegistry({ BUDGET_1_NAME: 'B1', BUDGET_1_SYNC_ID: 's1', BUDGET_1_ENCRYPTION_PASSWORD: 'e2e' }, httpsDefaults);
  assert.strictEqual(exited, null);
});
check('extra budget with encryption password over http BUDGET_1_SERVER_URL: process.exit(1)', () => {
  const { exited } = runRegistry({ BUDGET_1_NAME: 'B1', BUDGET_1_SYNC_ID: 's1', BUDGET_1_SERVER_URL: 'http://office:5006', BUDGET_1_ENCRYPTION_PASSWORD: 'e2e' }, httpsDefaults);
  assert.strictEqual(exited, 1);
});
check('extra budget http + ALLOW_INSECURE_UPSTREAM=true: ok (override)', () => {
  const { exited } = runRegistry({ ALLOW_INSECURE_UPSTREAM: 'true', BUDGET_1_NAME: 'B1', BUDGET_1_SYNC_ID: 's1', BUDGET_1_SERVER_URL: 'http://office:5006', BUDGET_1_ENCRYPTION_PASSWORD: 'e2e' }, httpsDefaults);
  assert.strictEqual(exited, null);
});

console.log(`\n[config-insecure-upstream] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
