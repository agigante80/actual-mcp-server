// tests/unit/adapter_op_timeout.test.js
// Regression for #270: a stalled (never-settling) upstream operation must be
// bounded by a per-operation timeout, so it REJECTS and releases the global api
// mutex (withApiLock), instead of hanging forever and wedging every subsequent
// tool call. That hang is the personal-finance production symptom.
//
// Transport-agnostic on purpose: both stdio and HTTP funnel reads through
// withActualApi and writes through queueWriteOperation (here via withWriteSession),
// and both share the one process-global withApiLock. So this single unit test
// covers the shared root cause for BOTH transports.
//
// Marker-gated to #270 (scripts/known-failing/270):
//   still hangs + marker present  -> EXPECTED (bug not yet fixed), exit 0
//   still hangs + marker absent    -> FAIL exit 2 (regression after fix)
//   rejects within bound (fixed)   -> assert the lock was released; then require
//                                     the marker to be gone (else exit 2, nudging
//                                     its removal so enforcement is on)
//
// The fix must expose an env-configurable per-op timeout; this test sets
// ACTUAL_OP_TIMEOUT_MS low so a bounded rejection lands well under BOUND_MS.
// Run: node tests/unit/adapter_op_timeout.test.js

import fs from 'node:fs';

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
process.env.ACTUAL_OP_TIMEOUT_MS  = process.env.ACTUAL_OP_TIMEOUT_MS  ?? '500';

const BOUND_MS = Number(process.env.REGRESSION_BOUND_MS || 3000);
const MARKER = new URL('../../scripts/known-failing/270', import.meta.url);

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const neverSettle = () => new Promise(() => {});
// Resolves to 'rejected' | 'resolved' | '__HANG__' within BOUND_MS.
const raceBound = (promise) => Promise.race([
  promise.then(() => 'resolved', () => 'rejected'),
  new Promise((r) => setTimeout(() => r('__HANG__'), BOUND_MS)),
]);

function knownHangExit(pathLabel) {
  const markerPresent = fs.existsSync(MARKER);
  console.log('');
  if (markerPresent) {
    console.log(`[#270] KNOWN-FAIL (${pathLabel}): stalled op did not reject within ${BOUND_MS}ms.`);
    console.log('[#270] scripts/known-failing/270 present -> EXPECTED; not failing the suite.');
    process.exit(0);
  }
  console.error(`[#270] REGRESSION (${pathLabel}): stalled op hung and no known-failing marker is present.`);
  process.exit(2);
}

(async () => {
  const apiMod = await import('@actual-app/api');
  (apiMod.default || apiMod).sync = async () => {};

  const adapter = await import('../../dist/src/lib/actual-adapter.js');
  const { withActualApi, withWriteSession, _setSkipApiInitForTests, _setApiInitializedForTests } = adapter;
  _setSkipApiInitForTests(true); // disarm real init/shutdown; isolate operation()

  // Positive: fast ops resolve normally while the mutex is free.
  console.log('[#270] positive: fast ops resolve, timeout not tripped');
  check((await withActualApi(async () => 'r')) === 'r', 'fast read resolves');
  check((await withWriteSession(async () => 'w')) === 'w', 'fast write resolves');

  // Review regression: a SYNCHRONOUS throw from the operation must surface as a
  // rejection and must not orphan the armed timeout timer. withOpTimeout invokes
  // the op via Promise.resolve().then(fn); without that, a sync throw would
  // escape before Promise.race is built, leaving the timer to fire an
  // unhandledRejection ~timeout later (fatal: process.exit(1)).
  console.log('\n[#270] synchronous throw rejects cleanly (no orphaned timer)');
  let syncErr = '';
  try { await withActualApi(() => { throw new Error('sync boom'); }); }
  catch (e) { syncErr = e?.message || ''; }
  check(/sync boom/.test(syncErr), 'synchronous throw surfaces as a rejection', `got "${syncErr}"`);
  check((await raceBound(withActualApi(async () => 'ok'))) === 'resolved',
    'mutex released after synchronous throw (subsequent read ran)');

  // Primary gate: a stalled WRITE (the production path via queueWriteOperation)
  // must reject within the bound, not hang.
  console.log('\n[#270] stalled write must reject within bound (not hang)');
  const wOutcome = await raceBound(withWriteSession(neverSettle));
  if (wOutcome === '__HANG__') knownHangExit('write');
  check(wOutcome === 'rejected', 'stalled write rejected within bound', `got ${wOutcome}`);

  // Lock must have been released: a subsequent write resolves.
  check((await raceBound(withWriteSession(async () => 'ok'))) === 'resolved',
    'mutex released after write timeout (subsequent write ran)');

  // Read path shares the same wrapper/mutex: also bounded + releasing.
  console.log('\n[#270] stalled read must reject within bound + release the lock');
  const rOutcome = await raceBound(withActualApi(neverSettle));
  if (rOutcome === '__HANG__') knownHangExit('read');
  check(rOutcome === 'rejected', 'stalled read rejected within bound', `got ${rOutcome}`);
  check((await raceBound(withActualApi(async () => 'ok'))) === 'resolved',
    'mutex released after read timeout (subsequent read ran)');

  // Init-path coverage (gate finding): the init/download upstream calls must be
  // bounded too, not just the operation body. The checks above skip init via
  // _setSkipApiInitForTests; here we arm the real legacy init path with a
  // never-settling api.init and assert it times out and releases the lock. A
  // timeout is not an auth error, so withAuthRetry does not retry it.
  console.log('\n[#270] stalled init is bounded (legacy init path)');
  const apiReal = apiMod.default || apiMod;
  const origInit = apiReal.init;
  const origShutdown = apiReal.shutdown;
  apiReal.init = () => neverSettle();
  apiReal.shutdown = async () => {};
  _setApiInitializedForTests(false); // force initActualApiForOperation to run init
  _setSkipApiInitForTests(false);    // exercise the real init path
  const iOutcome = await raceBound(withActualApi(async () => 'unreached'));
  apiReal.init = origInit;
  apiReal.shutdown = origShutdown;
  _setSkipApiInitForTests(true);     // restore isolation for the checks below
  if (iOutcome === '__HANG__') knownHangExit('init');
  check(iOutcome === 'rejected', 'stalled init rejected within bound', `got ${iOutcome}`);
  check((await raceBound(withActualApi(async () => 'ok'))) === 'resolved',
    'mutex released after init timeout (subsequent read ran)');

  // Reaching here means the fix is present and correct. Enforce that the
  // known-failing marker has been removed so future regressions fail.
  console.log('');
  if (fs.existsSync(MARKER)) {
    console.error('[#270] Behavior is now correct but scripts/known-failing/270 still exists.');
    console.error('[#270] Delete that marker so this test enforces (a future hang must fail).');
    process.exit(2);
  }
  if (failures === 0) {
    console.log('[#270] All operation-timeout regression checks passed ✓');
    process.exit(0);
  }
  console.error(`[#270] ${failures} check(s) FAILED`);
  process.exit(2);
})().catch((e) => { console.error('[#270] harness error:', e?.stack || e); process.exit(2); });
