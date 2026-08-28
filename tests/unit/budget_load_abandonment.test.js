// #390 round 3: an ABANDONED budget load must not become a silent, unserialised budget switch.
//
// `withOpTimeout` races; it does not cancel. When a downloadBudget exceeds
// ACTUAL_OP_TIMEOUT_MS the underlying call KEEPS RUNNING and eventually re-points the
// process-global singleton, outside the api mutex, at a moment nobody is waiting for.
//
// Upstream makes this worse than a failed no-op. `handlers['api/download-budget']` begins with
// `close-budget`, then `load-budget` and `sync-budget`, so an abandoned download CLOSES
// whatever budget is loaded and opens a different one mid-flight, underneath another session's
// lock.
//
// Two leaks were reproduced against the previous fix and both are pinned here:
//   (a) the record was only written on SUCCESS, so an abandoned load left it naming the old
//       budget while the singleton held the new one. The next session whose syncId matched the
//       stale record passed the precondition and read someone else's data.
//   (b) even recording the true outcome was not enough: the re-point landed BETWEEN a session's
//       check and its raw call. A mutex cannot serialise a promise its holder abandoned.
//
// The fix is not "record more carefully". The record is cleared BEFORE a load starts, so an
// abandonment can only leave it indeterminate (which forces a re-select), and the abandoned
// promise stays registered so the next operation WAITS for it inside the lock rather than
// racing it.
//
// Run: node tests/unit/budget_load_abandonment.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit390b';
process.env.ACTUAL_OP_TIMEOUT_MS = '250';           // shorter than the download below
process.env.BUDGET_1_NAME = 'alpha'; process.env.BUDGET_1_SYNC_ID = 'budget-A';
process.env.BUDGET_2_NAME = 'beta';  process.env.BUDGET_2_SYNC_ID = 'budget-B';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#390-abandon] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let loaded = null;
let downloadDelayMs = 0;
api.init = async () => {};
api.shutdown = async () => { loaded = null; };
api.sync = async () => {};
let hangForever = false;
api.downloadBudget = async (id) => {
  // Upstream closes the current budget FIRST, then opens the new one. Modelled, because it is
  // why an abandoned download is not a harmless no-op.
  loaded = null;
  if (hangForever) await new Promise(() => {});   // never settles, on purpose
  if (downloadDelayMs) await new Promise((r) => setTimeout(r, downloadDelayMs));
  loaded = id;
};
let readDelayMs = 0;
// Reads the singleton AFTER its delay, on purpose. The leak being modelled is an abandoned
// download landing DURING an operation, so a stub that snapshots `loaded` on entry cannot see
// it: the first version of this file did exactly that and passed with both defences removed.
api.getAccounts = async () => {
  if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
  return [{ id: ACC, name: `acct-in-${loaded}` }];
};
api.addTransactions = async () => 'ok';

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const apiState = await import('../../dist/src/lib/apiState.js');

// ---------------------------------------------------------------------------
describe('(1) a timed-out load leaves the record INDETERMINATE, never stale');
{
  await connectionPool.getConnection('sess-A');           // loads budget-A
  check(apiState.getLoadedBudgetSyncId() === 'budget-A', 'baseline: record names budget-A');

  downloadDelayMs = 400;   // longer than the 250ms bound, so it is abandoned at ~250 and
                           // lands at ~400, i.e. ~150ms into the next operation
  // switchBudget deliberately does NOT reject here, and that is correct rather than a
  // success-lie: it catches a pool-materialisation failure and warns, because the switch is
  // recorded in sessionBudgetState and subsequent calls take the legacy path, which resolves
  // getActiveBudgetConfig() per operation and loads the right budget. The claim "you are on
  // beta" is true in effect; only the pool entry is missing. I asserted a throw here first and
  // read the code when it did not, rather than adjusting the test to match.
  await requestContext.run({ sessionId: 'sess-B' }, () => adapter.switchBudget('beta'))
    .catch(() => {});

  const record = apiState.getLoadedBudgetSyncId();
  // The unsafe direction is "claims budget-A while the singleton is moving to budget-B".
  check(record !== 'budget-A',
    `the record does NOT still claim the old budget (got ${record})`);
}

// ---------------------------------------------------------------------------
describe('(2) the next operation WAITS for the abandoned load, then re-selects its own budget');
{
  // NOT asserting "still registered" any more. That was a proxy for "nothing can race the
  // landing", true only while the wait lived at two adapter call sites. #393 moved the wait
  // into withApiLock, so ANY lock acquisition settles an outstanding load and the pool's own
  // failure-cleanup settles it before this line runs. The proxy now reports the opposite of
  // what it meant; the property it stood for is asserted directly below.

  // TIMING IS THE TEST. B's abandoned download lands at roughly t+600 from its start. A's read
  // is issued now and its raw call is made to take 400ms, so without the wait-for-abandoned
  // defence the re-point lands INSIDE A's operation, which is exactly the window the previous
  // fix left open and which a mutex cannot close for a promise its holder abandoned.
  downloadDelayMs = 0;
  readDelayMs = 200;   // under the 250ms op bound, so the READ itself does not time out,
                       // while still spanning the moment the abandoned load lands
  const seen = await requestContext.run({ sessionId: 'sess-A' }, () => adapter.getAccounts());
  readDelayMs = 0;
  const name = Array.isArray(seen) ? seen[0]?.name : undefined;
  check(name === 'acct-in-budget-A',
    `session A read its own budget even though an abandoned load landed mid-operation (got ${name})`);
  check(!apiState._hasPendingBudgetLoadForTests(),
    'the abandoned load was settled and cleared, not left to land again later');
}

// ---------------------------------------------------------------------------
describe('(3) a FAILED load poisons the singleton rather than leaving it undescribed');
{
  const boom = new Error('download exploded');
  const good = api.downloadBudget;
  api.downloadBudget = async () => { loaded = null; throw boom; };
  await requestContext.run({ sessionId: 'sess-B' }, () => adapter.switchBudget('beta')).catch(() => {});
  api.downloadBudget = good;
  // Upstream closes the current budget before opening the new one, so "failed" does not mean
  // "unchanged". The only honest state is not-initialised, which forces a full re-init.
  check(apiState.isApiInitialized() === false || apiState.getLoadedBudgetSyncId() === null,
    `a failed load left the singleton poisoned, not falsely described (initialised=${apiState.isApiInitialized()}, record=${apiState.getLoadedBudgetSyncId()})`);
}

// ---------------------------------------------------------------------------
describe('(4) an abandoned RE-SELECT leaves no stale record, on a path nothing else poisons');
{
  // Case (1) cannot isolate this. Its abandonment happens during a session OPEN, and the
  // pool's failure cleanup calls setApiInitialized(false), which clears the record as a side
  // effect and masks whether the loader cleared it. Here the abandonment happens inside the
  // PRECONDITION's own re-select, where nothing else touches the record: if the loader only
  // wrote on success, the record would keep naming the budget the singleton is leaving, and
  // the next session whose syncId matches it would pass the check and read the wrong data.
  // Give sess-B2 a real preference for beta, through the tool, with a fast download.
  downloadDelayMs = 0;
  await connectionPool.getConnection('sess-B2');
  await requestContext.run({ sessionId: 'sess-B2' }, () => adapter.switchBudget('beta')).catch(() => {});

  // Now make the singleton look like it is on budget-A, so B2's next operation must re-select.
  loaded = 'budget-A';
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');

  downloadDelayMs = 400;                                  // the re-select will be abandoned
  await requestContext.run({ sessionId: 'sess-B2' }, () => adapter.getAccounts()).catch(() => {});
  downloadDelayMs = 0;

  const record = apiState.getLoadedBudgetSyncId();
  check(record !== 'budget-A',
    `an abandoned re-select did not leave the record naming the outgoing budget (got ${record})`);
  // HONEST LIMIT OF THIS CASE. It asserts the PROPERTY (no stale record) but cannot attribute
  // it: deleting the loader's clear-before-load leaves this green, because every failure route
  // reachable from here already poisons the singleton independently. A timeout message matches
  // TRANSIENT_ERROR_PATTERNS, so the pooled path drops the connection, which calls
  // setApiInitialized(false), which clears the record as a side effect. The clear-before is
  // kept as defence in depth for a future path that does not have that safety net, not because
  // a test here can distinguish it. Recorded rather than dressed up as coverage it is not.
  connectionPool.connections.delete('sess-B2');
  // awaitAbandonedBudgetLoad now takes the bound it races against (#393), so it cannot be
  // called unbounded even from a test. Drain through the lock, which is the real path.
  const { withApiLock } = await import('../../dist/src/lib/apiLock.js');
  await withApiLock(async () => undefined);
}

// ---------------------------------------------------------------------------
describe('(5) #393: a session opening during the window must not untrack the abandoned load');
{
  // registerBudgetLoad used to assign to a single slot, so a session opening while an earlier
  // load was abandoned overwrote its registration; the new load's success then cleared it, the
  // abandoned promise became untracked, landed later, and re-pointed the singleton. That is the
  // leak the tracking exists to prevent, reintroduced by the tracking itself. Registrations are
  // now a set whose entries remove themselves on settle.
  loaded = 'budget-A';
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');
  await connectionPool.getConnection('sess-D');

  downloadDelayMs = 400;                       // abandoned at ~250, lands at ~400
  await requestContext.run({ sessionId: 'sess-D2' }, () => adapter.switchBudget('beta')).catch(() => {});
  downloadDelayMs = 0;

  await connectionPool.getConnection('sess-E');   // the clobbering step
  const seen = await requestContext.run({ sessionId: 'sess-E' }, () => adapter.getAccounts())
    .catch((e) => [{ name: `ERR:${e?.message ?? ''}` }]);
  const name = Array.isArray(seen) ? seen[0]?.name : undefined;
  check(name === 'acct-in-budget-A',
    `a session opening during the window still saw its own budget (got ${name})`);
}

// ---------------------------------------------------------------------------
// RUNS LAST, AND THAT IS NOT COSMETIC. This case leaves a promise that never settles, and the
// fix deliberately keeps such a registration forever: an operation must not proceed past a load
// that may still land and re-point the singleton, and the promise cannot be cancelled. So from
// here on EVERY operation in this process fails closed with a bounded error. That is the
// intended behaviour, and it means nothing can run after it; putting this earlier made every
// later case crash on the timeout it causes. The operational consequence is worth stating
// plainly: a genuinely stuck upstream load degrades the process until it is restarted. That is
// the accepted trade against a silent cross-tenant leak or a silent wedge.
describe('(6) #393: a NEVER-settling load must not wedge the process');
{
  // The round-2 fix awaited the abandoned load UNBOUNDED, inside the api mutex, so one stuck
  // download blocked every session forever with no error after the first line and no recovery
  // short of a process restart: a P0 worse than the leak it closed, and exactly the mode
  // opTimeout.ts exists to remove.
  await connectionPool.getConnection('sess-W');
  hangForever = true;
  await requestContext.run({ sessionId: 'sess-W2' }, () => adapter.switchBudget('beta')).catch(() => {});
  hangForever = false;   // upstream healthy again; only the stuck promise remains

  const race = (p) => Promise.race([
    p.then(() => ({ ok: true })).catch((e) => ({ err: e?.message || String(e) })),
    new Promise((r) => setTimeout(() => r({ wedged: true }), 3000)),
  ]);
  const outcome = await race(requestContext.run({ sessionId: 'sess-W' }, () => adapter.getAccounts()));
  check(!outcome.wedged,
    `an operation after a never-settling load returned rather than wedging (got ${JSON.stringify(outcome).slice(0, 70)})`);
  // Fail CLOSED, not open: proceeding would run against a singleton a landing download may
  // re-point underneath it, which is the original leak.
  check(!!outcome.err && /timed out/i.test(outcome.err),
    `and it failed closed with a legible error (got ${outcome.err?.slice(0, 60) ?? 'no error'})`);
}

log(`\n[#390-abandon] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
