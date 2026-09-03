// tests/unit/adapter_write_queue_wakeup.test.js
//
// #278: LOST WAKEUP in the adapter write queue.
//
// A write enqueued while a previous batch is draining installs a 100ms debounce timer.
// That timer fires mid-drain, hits `if (isProcessingWrites || ...) return;` and never
// clears its own handle. The drain's `finally` then refuses to reschedule because it
// checks `writeSessionTimeout === null` and sees a dead-but-non-null handle. The queued
// operation is never dispatched, so its promise never settles.
//
// The per-op timeout (#270, `withOpTimeout`) cannot save this: it bounds EXECUTION, and
// the operation never starts. That is why the CI symptom was 120s of total silence with
// no "timed out" error, rather than a slow-but-successful call.
//
// NOTE on process isolation: `config.ts` reads `process.env` ONCE at module load, and
// Node caches that module. Cache-busting the adapter import does NOT re-read the config.
// So every case that depends on a specific ACTUAL_OP_TIMEOUT_MS runs in its own child
// process. Without this, such a case passes vacuously against whatever value happened to
// be loaded first.
//
// Run: node tests/unit/adapter_write_queue_wakeup.test.js

import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADAPTER = pathToFileURL(join(ROOT, 'dist', 'src', 'lib', 'actual-adapter.js')).href;
const RETRY = pathToFileURL(join(ROOT, 'dist', 'src', 'lib', 'retry.js')).href;
const APISTATE = pathToFileURL(join(ROOT, 'dist', 'src', 'lib', 'apiState.js')).href;

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}${detail ? ' -> ' + detail : ''}`); failed++; }
}

/**
 * Run a snippet in a child process with a specific env. The snippet must print exactly
 * one line of JSON to stdout via `emit(obj)`. Returns the parsed object.
 * A child that hangs is itself a failure signal, so it gets a hard timeout.
 */
function runInChild(env, body, timeoutMs = 20000) {
  const preamble = `
    const emit = (o) => process.stdout.write('@@' + JSON.stringify(o) + '@@');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const settle = (p, ms) => Promise.race([
      p.then(() => ({ state: 'resolved' }), (e) => ({ state: 'rejected', message: String(e && e.message || e) })),
      new Promise((r) => setTimeout(() => r({ state: 'HANG' }), ms)),
    ]);
    const adapter = await import(${JSON.stringify(ADAPTER)});
    const { isRetryableError } = await import(${JSON.stringify(RETRY)});
    adapter._setSkipApiInitForTests(true);
    adapter._setApiInitializedForTests(true);
    const { withWriteSession } = adapter;
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', preamble + body], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      ACTUAL_PASSWORD: 'stub-password-for-unit-test',
      ...env,
    },
  });
  const m = /@@(.*?)@@/s.exec(res.stdout || '');
  if (!m) return { __error: `child produced no result (status=${res.status}, signal=${res.signal})` };
  return JSON.parse(m[1]);
}

console.log('\n[adapter-write-queue-wakeup]');

// ---------------------------------------------------------------------------
// Scenario 2: baseline. A single write on an idle queue still resolves.
// ---------------------------------------------------------------------------
{
  const r = runInChild({ ACTUAL_OP_TIMEOUT_MS: '5000' }, `
    const out = await settle(withWriteSession(async () => 'solo'), 4000);
    emit(out); process.exit(0);
  `);
  check('IDLE: a single write on an idle queue resolves', r.state === 'resolved', r.state || r.__error);
}

// ---------------------------------------------------------------------------
// Scenario 6: THE REGRESSION. Red on develop before the fix.
// A is slow (300ms). B is enqueued 150ms in, while A is draining. The process then goes
// idle: NO third write arrives to rescue B.
// ---------------------------------------------------------------------------
{
  const r = runInChild({ ACTUAL_OP_TIMEOUT_MS: '5000' }, `
    const A = withWriteSession(() => new Promise((r) => setTimeout(() => r('A'), 300)));
    await sleep(150);                                  // A's 100ms debounce fired; A is mid-drain
    const B = withWriteSession(async () => 'B');
    const [a, b] = await Promise.all([settle(A, 4000), settle(B, 4000)]);
    emit({ a: a.state, b: b.state }); process.exit(0);
  `);
  check('LOST WAKEUP: the first write still resolves', r.a === 'resolved', r.a || r.__error);
  check(
    'LOST WAKEUP: a write enqueued during a drain is dispatched without a third write',
    r.b === 'resolved',
    r.b === 'HANG' ? 'B never settled: the queue was never re-drained (#278)' : (r.b || r.__error),
  );
}

// ---------------------------------------------------------------------------
// Scenario 3: COALESCING must survive the fix.
// N writes enqueued in ONE tick must produce exactly ONE batch dispatch. A naive fix
// (drain on every enqueue) closes the deadlock while silently turning one init/sync cycle
// into N, which no other test in the suite would catch.
// ---------------------------------------------------------------------------
{
  const r = runInChild({ ACTUAL_OP_TIMEOUT_MS: '5000' }, `
    if (typeof adapter._getWriteQueueBatchCountForTests !== 'function') {
      emit({ hook: false }); process.exit(0);
    }
    const before = adapter._getWriteQueueBatchCountForTests();
    const writes = [1,2,3,4,5].map((n) => withWriteSession(async () => n));
    const outs = await Promise.all(writes.map((w) => settle(w, 4000)));
    emit({
      hook: true,
      allResolved: outs.every((o) => o.state === 'resolved'),
      batches: adapter._getWriteQueueBatchCountForTests() - before,
    });
    process.exit(0);
  `);
  check('COALESCING: the _getWriteQueueBatchCountForTests hook exists', r.hook === true, r.__error || 'hook not exported');
  if (r.hook) {
    check('COALESCING: all 5 same-tick writes resolve', r.allResolved === true);
    check('COALESCING: 5 writes in one tick produce exactly ONE batch', r.batches === 1, `batches=${r.batches}`);
  }
}

// ---------------------------------------------------------------------------
// Scenarios 7 + 8: residency bound.
//
// The drain is held in flight for longer than the residency bound: A's operation takes
// 3000ms but its EXECUTION is cut by withOpTimeout at 400ms, so the drain runs roughly
// t=100..t=500. B is enqueued at t=110, so its residency timer fires at t=510, while the
// re-drain cannot dispatch it until roughly t=600 (drain end + the 100ms debounce).
// B must therefore reject on the residency bound rather than hang.
// ---------------------------------------------------------------------------
{
  const r = runInChild({ ACTUAL_OP_TIMEOUT_MS: '400' }, `
    const A = withWriteSession(() => new Promise((r) => setTimeout(() => r('A'), 3000)));
    // Attach A's handler IMMEDIATELY. Its execution is cut by withOpTimeout at 400ms, and
    // an unobserved rejection kills the child before B is ever evaluated.
    const aSettled = settle(A, 6000);
    await sleep(110);                                  // drain just started; enqueue B behind it
    const B = withWriteSession(async () => 'B');
    const b = await settle(B, 6000);
    const a = await aSettled;
    const err = b.state === 'rejected' ? new Error(b.message) : null;
    emit({
      a: a.state,
      b: b.state,
      message: b.message || '',
      retryable: err ? isRetryableError(err) : null,
    });
    process.exit(0);
  `);
  check('RESIDENCY: an undispatched op rejects rather than hanging', r.b === 'rejected', r.b || r.__error);
  if (r.b === 'rejected') {
    check(
      'RESIDENCY: the error names the stall and says nothing ran',
      /not dispatched/i.test(r.message) && /never ran/i.test(r.message),
      r.message.slice(0, 90),
    );
    check(
      'RESIDENCY: the error does NOT contain the substring "timed out"',
      !/timed out/i.test(r.message),
      r.message.slice(0, 90),
    );
    check(
      'RESIDENCY: the error is TERMINAL, so no healthy pooled connection is dropped',
      r.retryable === false,
      `isRetryableError=${r.retryable}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scenario 5: ACTUAL_OP_TIMEOUT_MS=0 disables the residency bound (documented escape
// hatch, same semantics as withOpTimeout). A write must still dispatch and resolve, and
// nothing may reject on a timer. Runs in its own process, or config caching makes it vacuous.
// ---------------------------------------------------------------------------
{
  const r = runInChild({ ACTUAL_OP_TIMEOUT_MS: '0' }, `
    const A = withWriteSession(() => new Promise((r) => setTimeout(() => r('A'), 300)));
    await sleep(150);
    const B = withWriteSession(async () => 'B');
    const [a, b] = await Promise.all([settle(A, 5000), settle(B, 5000)]);
    emit({ a: a.state, b: b.state }); process.exit(0);
  `);
  check('DISABLED: with ACTUAL_OP_TIMEOUT_MS=0 both writes still resolve', r.a === 'resolved' && r.b === 'resolved', `${r.a}/${r.b} ${r.__error || ''}`);
}

// ---------------------------------------------------------------------------
// #419 DRAIN self-heal. The write drain inits once and shuts down once per batch,
// so the keep-alive that stops a stdio process re-logging-in per op could leave a
// CORRUPT singleton live after a transient failure. The batch-end shutdown must
// force a full teardown when any op in the batch hit an infrastructure-level
// error, so the next batch re-inits fresh; a domain error must leave it alive.
// Runs in its own process because MCP_STDIO_MODE and the singleton flag are
// process-global (same reason the scenarios above fork).
// ---------------------------------------------------------------------------
{
  // Transient error in a drained write -> singleton torn down (self-heal).
  const r = runInChild({ MCP_STDIO_MODE: 'true' }, `
    const apiState = await import(${JSON.stringify(APISTATE)});
    adapter._setApiInitializedForTests(false);
    let msg = '';
    try {
      await withWriteSession(async () => { throw new Error('socket hang up'); });
    } catch (e) { msg = String(e && e.message || e); }
    await sleep(300);                       // let the batch-end shutdown run
    emit({ msg, aliveAfter: apiState.isApiInitialized() });
    process.exit(0);
  `);
  check('DRAIN SELF-HEAL: the transient error propagates', /socket hang up/.test(r.msg || ''), r.msg || r.__error);
  check(
    'DRAIN SELF-HEAL: a transient drain error tears the stdio singleton down (next batch re-inits)',
    r.aliveAfter === false,
    r.aliveAfter === undefined ? r.__error : `isApiInitialized=${r.aliveAfter}`,
  );
}
{
  // Domain error in a drained write -> singleton kept alive (no per-op login).
  const r = runInChild({ MCP_STDIO_MODE: 'true' }, `
    const apiState = await import(${JSON.stringify(APISTATE)});
    adapter._setApiInitializedForTests(false);
    try {
      await withWriteSession(async () => { throw new Error('Field "payee_name" does not exist'); });
    } catch (e) { /* expected */ }
    await sleep(300);
    emit({ aliveAfter: apiState.isApiInitialized() });
    process.exit(0);
  `);
  check(
    'DRAIN SELF-HEAL: a domain drain error leaves the stdio singleton alive (kept warm)',
    r.aliveAfter === true,
    r.aliveAfter === undefined ? r.__error : `isApiInitialized=${r.aliveAfter}`,
  );
}

// ---------------------------------------------------------------------------
// #422 DRAIN + rate-limit. A rate-limit error inside a drained write must NOT
// tear the stdio singleton down (a throttle is not a corrupt connection), unlike
// a genuine infrastructure error which does (#419). This is the non-login write
// surface the #383 cascade also hit.
// ---------------------------------------------------------------------------
{
  const r = runInChild({ MCP_STDIO_MODE: 'true' }, `
    const apiState = await import(${JSON.stringify(APISTATE)});
    adapter._setApiInitializedForTests(false);
    let msg = '';
    try {
      await withWriteSession(async () => { throw new Error('Authentication failed: Too many requests, please try again later.'); });
    } catch (e) { msg = String(e && e.message || e); }
    await sleep(300);
    emit({ msg, aliveAfter: apiState.isApiInitialized() });
    process.exit(0);
  `);
  check('DRAIN RATE-LIMIT: the rate-limit error propagates', /too many requests/i.test(r.msg || ''), r.msg || r.__error);
  check(
    'DRAIN RATE-LIMIT: a rate-limit drain error keeps the stdio singleton alive (no teardown, no relogin storm)',
    r.aliveAfter === true,
    r.aliveAfter === undefined ? r.__error : `isApiInitialized=${r.aliveAfter}`,
  );
}

console.log(`\n[adapter-write-queue-wakeup] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
