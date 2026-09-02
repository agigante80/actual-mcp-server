// #392: api.shutdown() must not tear the singleton down under an in-flight operation.
//
// #390 put the pool's api.init + downloadBudget under the process-global api mutex, and put
// getConnection's failure-cleanup shutdown under it too. The REMAINING shutdown sites still ran
// without the lock: shutdownConnection (the idle sweep and explicit session close),
// shutdownSharedConnection, and shutdownAll.
//
// Reproduced during #390's security review for the sibling site that #390 fixed: session B's
// session-open failed, its cleanup api.shutdown() fired while session A was mid-operation INSIDE
// the lock, and A observed a torn-down api. Same shape, three call sites.
//
// This is a LIVENESS and partial-write hazard, not a cross-tenant one: every one of these calls
// setApiInitialized(false), which clears the recorded budget, so #390's precondition sees an
// uninitialised singleton and re-selects.
//
// The thing that makes the fix non-trivial, and what case 2 pins: shutdownConnection IS reached
// from inside withApiLock today (the adapter's pooled error paths and the write drain), and the
// mutex is NOT reentrant, so wrapping it blindly deadlocks. The symptom would be a ~30s stall
// ended by #270's timeout rather than an obvious hang, which is why the split is explicit.
//
// Run: node tests/unit/pool_shutdown_under_lock.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit392';
process.env.ACTUAL_OP_TIMEOUT_MS = '2000';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#392-shutdown-lock] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

const events = [];
api.init = async () => { events.push('init'); };
api.downloadBudget = async () => { events.push('download'); };
api.getBudgetMonths = async () => ['2026-01'];
api.sync = async () => {};
api.shutdown = async () => { events.push('shutdown'); };

const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { withApiLock } = await import('../../dist/src/lib/apiLock.js');
const apiState = await import('../../dist/src/lib/apiState.js');

// --- 1. the property ------------------------------------------------------
describe('a shutdown waits for an in-flight operation instead of tearing the api down under it');
{
  events.length = 0;
  apiState.setApiInitialized(true);
  // Plant an initialised pool entry without driving a real session open.
  connectionPool.connections?.set?.('sess-A', {
    sessionId: 'sess-A', initialized: true, lastActivity: Date.now(),
    dataDir: '/tmp/unit392', serverUrl: 'http://test-server', password: 'pw', syncId: 'budget-A',
  });

  let opFinished = false;
  const inFlight = withApiLock(async () => {
    events.push('op-start');
    await new Promise((r) => setTimeout(r, 300));
    events.push('op-end');
    opFinished = true;
  });

  // The idle sweep / session close path, which does NOT hold the lock.
  await new Promise((r) => setTimeout(r, 50));
  const sweep = connectionPool.shutdownConnection('sess-A');
  await Promise.all([inFlight, sweep]);

  const opEnd = events.indexOf('op-end');
  const shutdown = events.indexOf('shutdown');
  check(opFinished, 'the in-flight operation completed');
  // NOT `shutdown === -1 || ...`: that escape hatch would pass vacuously if a future change made
  // the shutdown a no-op, which is exactly the regression this test exists to catch.
  check(
    shutdown !== -1 && opEnd < shutdown,
    `the shutdown ran, and only AFTER the operation finished (events: ${events.join(',')})`,
  );
}

// --- 2. the deadlock the split exists to avoid ----------------------------
describe('a caller that ALREADY holds the lock can still drop its entry, without deadlocking');
{
  events.length = 0;
  apiState.setApiInitialized(true);
  connectionPool.connections?.set?.('sess-B', {
    sessionId: 'sess-B', initialized: true, lastActivity: Date.now(),
    dataDir: '/tmp/unit392', serverUrl: 'http://test-server', password: 'pw', syncId: 'budget-A',
  });

  const started = Date.now();
  let timedOut = false;
  await withApiLock(async () => {
    // Exactly what the adapter's pooled error paths and the write drain do.
    const done = connectionPool.shutdownConnectionLocked('sess-B');
    const race = await Promise.race([
      done.then(() => 'done'),
      new Promise((r) => setTimeout(() => r('stalled'), 1500)),
    ]);
    timedOut = race === 'stalled';
  });
  const elapsed = Date.now() - started;
  check(!timedOut, `no deadlock from inside the lock (elapsed ${elapsed}ms)`);
  check(elapsed < 1500, `and no ~30s stall signature (elapsed ${elapsed}ms)`);
}

// --- 3. the rejection path the lock itself introduced ---------------------
// Review finding (blocking): since #393, ACQUIRING the api lock settles any abandoned budget load
// and THROWS on timeout, so wrapping shutdownConnection gave it a rejection path the old body
// never had. Its callers are cleanup paths that do not expect one: cleanupIdleConnections runs
// from setInterval unawaited, and "abandoned budget load timed out" is NOT in
// rejection-allowlist.ts, so the escape reached the unhandledRejection handler and called
// process.exit(1). That is #393's own defect at a new acquisition site.
describe('a stuck abandoned load cannot turn a cleanup into an unhandled rejection');
{
  events.length = 0;
  apiState.setApiInitialized(true);
  connectionPool.connections?.set?.('sess-C', {
    sessionId: 'sess-C', initialized: true, lastActivity: 0,   // long expired
    dataDir: '/tmp/unit392', serverUrl: 'http://test-server', password: 'pw', syncId: 'budget-A',
  });

  // A registered load that does not settle DURING this case: every lock acquisition waits for it,
  // bounded, and throws. It is released at the end of the case, because registerBudgetLoad only
  // removes an entry when its promise settles and there is no unregister hook. Leaving it pending
  // poisons every LATER case in this file, which is exactly what the first version of this test
  // did: case 4 then ran entirely on the unlocked fallback path while claiming to exercise the
  // locked one, and cost 4 seconds of pure timeout in the chain.
  let landStuckLoad;
  apiState.registerBudgetLoad(new Promise((r) => { landStuckLoad = r; }));

  let rejected = null;
  await connectionPool.shutdownConnection('sess-C', { evict: true }).catch((e) => { rejected = e; });

  check(rejected === null, `shutdownConnection did NOT reject (got ${rejected && rejected.message})`);
  check(
    connectionPool.connections?.get?.('sess-C') === undefined,
    'and the entry was still removed, so a stuck load cannot make idle sessions un-evictable',
  );

  landStuckLoad();
  await new Promise((r) => setImmediate(r));   // let the registration set drain its self-delete
  check(
    apiState._hasPendingBudgetLoadForTests() === false,
    'the stuck load is released, so later cases run against a FREE lock rather than the fallback',
  );
}

// --- 4. the sweep must not evict a session that came back --------------------
describe('a session touched while the eviction waited for the lock is not closed');
{
  apiState.setApiInitialized(true);
  connectionPool.connections?.set?.('sess-D', {
    sessionId: 'sess-D', initialized: true, lastActivity: 0,   // expired when marked
    dataDir: '/tmp/unit392', serverUrl: 'http://test-server', password: 'pw', syncId: 'budget-A',
  });
  // The sweep decided sess-D was expired. Before the lock arrives, the session is active again.
  connectionPool.touch?.('sess-D');
  await connectionPool.shutdownConnection('sess-D', { evict: true, onlyIfExpired: true });
  check(
    connectionPool.connections?.get?.('sess-D') !== undefined,
    'the re-touched session keeps its connection instead of being closed mid-conversation',
  );
  // and without the re-check it is still evicted, which is the pre-fix behaviour.
  await connectionPool.shutdownConnection('sess-D', { evict: true });
  check(connectionPool.connections?.get?.('sess-D') === undefined, 'an unconditional shutdown still evicts');
}

// --- 5. #412: shutdownAll takes ONE acquisition, not one per session -------
// Since #392 each shutdownConnection takes the api mutex, and since #393 acquiring it settles any
// abandoned load, bounded, and throws on timeout while KEEPING the registration. So with a stuck
// load, N sessions cost N times ACTUAL_OP_TIMEOUT_MS. Fifteen sessions at the 30s default is 450
// seconds, and Docker sends SIGKILL after a 10 second grace period: the container dies with a page
// of "could not acquire" lines and no clean api.shutdown().
describe('graceful shutdown costs one lock acquisition, not one per session');
{
  apiState.setApiInitialized(true);
  for (const sid of ['sd-1', 'sd-2', 'sd-3']) {
    connectionPool.connections?.set?.(sid, {
      sessionId: sid, initialized: true, lastActivity: Date.now(),
      dataDir: '/tmp/unit392', serverUrl: 'http://test-server', password: 'pw', syncId: 'budget-A',
    });
  }
  // A load that never settles, so every acquisition pays the full bound.
  let releaseStuck;
  apiState.registerBudgetLoad(new Promise((r) => { releaseStuck = r; }));

  const started = Date.now();
  await connectionPool.shutdownAll();
  const elapsed = Date.now() - started;

  releaseStuck();
  await new Promise((r) => setImmediate(r));

  const bound = Number(process.env.ACTUAL_OP_TIMEOUT_MS || 2000);
  check(
    elapsed < bound * 2,
    `three sessions cost roughly ONE bound, not three (elapsed ${elapsed}ms, bound ${bound}ms)`,
  );
  for (const sid of ['sd-1', 'sd-2', 'sd-3']) {
    check(connectionPool.connections?.get?.(sid) === undefined, `${sid} was still torn down`);
  }
  apiState._clearPendingBudgetLoadsForTests();
}

// --- 6. #411: the Locked variants assert their precondition ----------------
// The call-site audit lives in a doc comment, and this repo has paid four times for the difference
// between a convention and a check.
//
// The first version of this case built a `warnings` array, never installed a stub, and asserted
// only "it did not throw" and "it deleted the entry", both true with or without the guard. Review
// proved it by deleting the whole precondition block and watching the suite stay green. This one
// captures the warning through the winston instance the module logger delegates to, which is
// resolved per call, so patching it after import works.
describe('a Locked variant called without the mutex warns, and says nothing when told to expect it');
{
  const loggerMod = await import('../../dist/src/logger.js');
  const winston = loggerMod.default || loggerMod;
  const realWarn = winston.warn.bind(winston);
  const seen = [];
  winston.warn = (msg, ...rest) => { seen.push(String(msg)); return realWarn(msg, ...rest); };

  const { isApiLockHeld } = await import('../../dist/src/lib/apiLock.js');
  check(isApiLockHeld() === false, 'baseline: the lock is not held here');

  apiState.setApiInitialized(true);
  const plant = (sid) => connectionPool.connections?.set?.(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/tmp/unit392', serverUrl: 'http://test-server', password: 'pw', syncId: 'budget-A',
  });

  // (a) unlocked and NOT expecting it: must warn, and must still do the work.
  plant('sd-warn');
  seen.length = 0;
  let threw = false;
  await connectionPool.shutdownConnectionLocked('sd-warn').catch(() => { threw = true; });
  const warnedUnlocked = seen.some((m) => /without the api mutex/i.test(m));
  check(!threw, 'it warns rather than throwing, because cleanup must not fail louder than its cause');
  check(warnedUnlocked, `an unlocked Locked call WARNS (captured: ${JSON.stringify(seen).slice(0, 120)})`);
  check(connectionPool.connections?.get?.('sd-warn') === undefined, 'and it still did the work');

  // (b) unlocked and expecting it: the deliberate fallback path must be silent, or #412's
  // teardown prints one of these per session at the exact moment it chose not to take the lock.
  plant('sd-quiet');
  seen.length = 0;
  await connectionPool.shutdownConnectionLocked('sd-quiet', { expectUnlocked: true }).catch(() => {});
  check(
    !seen.some((m) => /without the api mutex/i.test(m)),
    `expectUnlocked suppresses the warning (captured: ${JSON.stringify(seen).slice(0, 120)})`,
  );
  check(connectionPool.connections?.get?.('sd-quiet') === undefined, 'and it still did the work');

  winston.warn = realWarn;
}

log(`\n[#392-shutdown-lock] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
