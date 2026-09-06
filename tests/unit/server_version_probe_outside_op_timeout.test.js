// The #276 server-version probe must run OUTSIDE the operation's own timeout.
//
// WHY THIS FILE EXISTS, and why it is separate: review caught this twice, and the second time
// it caught the FIX being insufficient. #453 changed the once-guard to latch only on a real
// answer, which made a stalled probe repeatable rather than one-shot. Bounding the probe was the
// first fix and was not enough: while it still sat INSIDE `withOpTimeout(operation)`, its budget
// came out of the operation's, so an operation that took more than (ACTUAL_OP_TIMEOUT_MS minus
// the probe bound) and SUCCEEDED was still reported to the caller as
// "Actual API operation timed out". On a deliberately lowered timeout the probe alone could
// consume the whole budget, and since that message is classed transient it would also drop the
// pooled connection. An advisory diagnostic must never be able to fail an operation that worked.
//
// The file is separate because it needs ACTUAL_OP_TIMEOUT_MS set BEFORE config.ts is imported,
// and every other guard test imports config transitively at module load.
//
// Mutation self-check: move the checkServerVersionOnce call back inside withOpTimeout in
// withActualApi and this goes red. Without that, the assertion cannot fail.
//
// Run: node tests/unit/server_version_probe_outside_op_timeout.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';
// 250 is the floor config.ts clamps to; the probe below deliberately takes longer than that.
process.env.ACTUAL_OP_TIMEOUT_MS = '250';

import assert from 'assert';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

const PROBE_MS = 600;   // longer than the whole operation budget, on purpose
let probeCalls = 0;

api.init = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2026-01'];
api.sync = async () => {};
api.getAccounts = async () => [{ id: 'a1', name: 'Test' }];
api.getServerVersion = async () => {
  probeCalls++;
  await new Promise((r) => setTimeout(r, PROBE_MS));
  return { version: '99.9.0' };   // ahead of anything bundled, so it also emits the warning
};

const { _resetForTests } = await import('../../dist/src/lib/server-version-guard.js');
const apiState = await import('../../dist/src/lib/apiState.js');
const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default || adapterMod;

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
async function check(name, fn) {
  try { await fn(); log(`  ok: ${name}`); passed++; }
  catch (err) { log(`  FAIL: ${name}\n    ${err.message}`); failed++; }
}

log('\n[server-version-probe] the probe must not spend the operation\'s timeout budget');

await check('a SLOW probe does not fail an operation that succeeded', async () => {
  _resetForTests();
  // PRE-INITIALISE THE SINGLETON, and this is the load-bearing part of the setup.
  //
  // The first version of this test left the api uninitialised, so the operation performed a
  // budget load, and the #453 PRE-DOWNLOAD probe in loadBudgetTracked ran first and consumed the
  // once-guard. The adapter's post-op probe then returned instantly and the test passed with the
  // mutation applied: it was measuring the loader's call site while claiming to measure the
  // adapter's. Caught only because the mutation refused to go red.
  //
  // With the singleton already live and holding this session's budget, init short-circuits, no
  // budget is loaded, and the post-op probe is the ONLY one that can run.
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId(process.env.ACTUAL_BUDGET_SYNC_ID);
  const started = Date.now();
  const accounts = await adapter.getAccounts();
  const elapsed = Date.now() - started;

  assert.ok(Array.isArray(accounts), `expected the operation's own result, got ${JSON.stringify(accounts)}`);
  assert.strictEqual(accounts.length, 1, 'the operation result must be returned unchanged');
  assert.strictEqual(probeCalls, 1, 'the probe should have run exactly once');
  // The probe genuinely delayed the call, which is what proves it ran and that the operation
  // survived it rather than the probe having been skipped.
  assert.ok(elapsed >= PROBE_MS - 50, `expected the probe to have run (elapsed ${elapsed}ms)`);
});

await check('and the once-guard still holds: a second operation does not re-probe', async () => {
  const before = probeCalls;
  await adapter.getAccounts();
  assert.strictEqual(probeCalls, before, 'a judged version must never be asked for again');
});

log(`\n[server-version-probe] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
