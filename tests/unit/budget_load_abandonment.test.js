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
let slowBudget = null;
api.downloadBudget = async (id) => {
  // Upstream closes the current budget FIRST, then opens the new one. Modelled, because it is
  // why an abandoned download is not a harmless no-op.
  loaded = null;
  if (hangForever) await new Promise(() => {});   // never settles, on purpose
  if (downloadDelayMs && (slowBudget === null || slowBudget === id)) {
    await new Promise((r) => setTimeout(r, downloadDelayMs));
  }
  loaded = id;
};
let readDelayMs = 0;
// Reads the singleton AFTER its delay, on purpose. The leak being modelled is an abandoned
// download landing DURING an operation, so a stub that snapshots `loaded` on entry cannot see
// it: the first version of this file did exactly that and passed with both defences removed.
// #396: loadBudgetTracked probes after every download. This file models an abandoned download
// that re-points the singleton, so the probe must read the SAME `loaded` variable.
api.getBudgetMonths = async () => { if (!loaded) throw { type: 'APIError', message: 'No budget file is open' }; return ['2026-01']; };
api.getAccounts = async () => {
  if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
  return [{ id: ACC, name: `acct-in-${loaded}` }];
};
// #406: the witness for case (7). The adapter destructures the raw api functions at module load,
// so a stub reassigned AFTER that import is never called. The sampling has to live here.
let sampleWriteWitness = false;
let pendingAtWrite = null;
api.addTransactions = async () => {
  if (sampleWriteWitness && pendingAtWrite === null) {
    pendingAtWrite = apiState._hasPendingBudgetLoadForTests();
  }
  return 'ok';
};

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
  // HONEST LIMIT. This case does NOT verify the set. Review reverted apiState to the old
  // single-slot shape and this stayed green, because moving the wait into withApiLock made the
  // clobbering unreachable here: the opening session settles the abandoned load at acquisition,
  // so there is nothing outstanding left to overwrite. Under the current design at most one
  // registration can be live at a time, which makes the set defence in depth rather than the
  // load-bearing fix, and saying otherwise would be claiming coverage that does not exist.
  // What this case does pin is the PROPERTY: a session opening in that window sees its own
  // budget, and that goes red if the wait is removed from the lock.
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

  // A WRITE, and this is the assertion whose absence hid a P0. The first version of this case
  // exercised only a READ, and the read path was fine. The write path was not: the drain's
  // batch-rejection handler sat INSIDE the lock callback, which was sound while withApiLock
  // could only reject from that callback. Once acquiring the lock could itself reject, the
  // rejection bypassed the handler, every queued write never settled (its residency timer is
  // cleared at dispatch, so nothing could rescue it: the #278 signature), and because the drain
  // is invoked unawaited the rejection escaped as an unhandledRejection the allowlist does not
  // cover, so the process exited. A stalled download would have taken the server down for every
  // tenant.
  const writeOutcome = await race(
    requestContext.run({ sessionId: 'sess-W' }, () =>
      adapter.addTransactions([{ account: ACC, date: '2026-01-01', amount: -1 }])),
  );
  check(!writeOutcome.wedged,
    `a WRITE after a never-settling load settles rather than stranding its caller (got ${JSON.stringify(writeOutcome).slice(0, 70)})`);
  check(!!writeOutcome.err,
    `and it rejects rather than silently succeeding (got ${writeOutcome.err?.slice(0, 60) ?? 'no error'})`);

  // HYGIENE, and it is load bearing for every case below this one. The load registered above never
  // settles, and `registerBudgetLoad` only removes an entry when its promise settles: there is no
  // unregister hook. Leaving it pending means every LATER acquisition in this file times out, so a
  // later case would silently exercise a poisoned lock while claiming to test something else.
  // Clearing the registration set is the only way back, and it is safe here because every
  // assertion in this case has already run.
  apiState._clearPendingBudgetLoadsForTests();
  check(apiState._hasPendingBudgetLoadForTests() === false,
    'the never-settling load is deregistered, so later cases run against a FREE lock');
}

// --- (7) #406: the wait is per OPERATION, not per lock acquisition -----------
// #393 made settling an abandoned load part of ACQUIRING the api lock, which makes the set of
// call sites stop mattering. That holds wherever one acquisition serves one operation. The write
// drain is the exception: it acquires ONCE and runs N operations inside, so before #406 every
// operation after the first in a batch ran without ever waiting, against a singleton an abandoned
// load was about to re-point. That is the #390 class reached by a different route.
//
// The witness is sampled from INSIDE the second operation's raw write, because that is the moment
// that matters: a check before or after the drain cannot tell whether the op itself was serialised
// against the pending load.
describe('(7) #406: a LATER operation in the same drain still waits for an abandoned load');
{
  // THE SHAPE MATTERS, and the first version of this case got it wrong. With ONE operation per
  // drain the lock acquisition's own wait (#393) covers it, so the case passed with the fix
  // removed: a test that could not fail. #406 is specifically about a drain that acquires the lock
  // ONCE and then runs N operations, where only the first is covered.
  //
  // So: two writes enqueued in ONE debounce window. Op1 is on a different budget, so it re-selects,
  // and its download outruns ACTUAL_OP_TIMEOUT_MS and is ABANDONED while still in flight. Op2 then
  // runs in the same drain, after the acquisition, with that load still pending.
  hangForever = false;
  readDelayMs = 0;
  loaded = 'budget-A';
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');
  apiState._clearPendingBudgetLoadsForTests();

  // Only budget-B is slow, so op1 abandons while op2's own re-select stays fast.
  slowBudget = 'budget-B';
  downloadDelayMs = 900;

  sampleWriteWitness = true;
  pendingAtWrite = null;

  // Session-to-budget mapping FIRST, while everything is fast. Doing the switches inline with the
  // writes was the earlier mistake: switchBudget is not a queued write, so the two writes never
  // shared a debounce window and never formed one batch.
  downloadDelayMs = 0;
  slowBudget = null;
  await requestContext.run({ sessionId: 'sess-406-B' }, () => adapter.switchBudget('beta')).catch(() => {});
  await requestContext.run({ sessionId: 'sess-406-A' }, () => adapter.switchBudget('alpha')).catch(() => {});

  // Now make ONLY budget-B slow, and leave budget-A loaded so op-A needs no slow re-select.
  loaded = 'budget-A';
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');
  apiState._clearPendingBudgetLoadsForTests();
  slowBudget = 'budget-B';
  downloadDelayMs = 900;

  sampleWriteWitness = true;
  pendingAtWrite = null;

  // Enqueued back to back with no await between them, so they land in ONE debounce window and one
  // drain: one lock acquisition, two operations. B first, so its abandoned load is in flight when
  // A runs.
  const opB = requestContext.run({ sessionId: 'sess-406-B' }, () =>
    adapter.addTransactions([{ account: ACC, date: '2026-01-01', amount: -1 }]),
  ).catch((e) => 'B-rejected: ' + e.message);
  const opA = requestContext.run({ sessionId: 'sess-406-A' }, () =>
    adapter.addTransactions([{ account: ACC, date: '2026-01-01', amount: -2 }]),
  ).catch((e) => 'A-rejected: ' + e.message);

  const [rB, rA] = await Promise.all([opB, opA]);
  sampleWriteWitness = false;
  downloadDelayMs = 0;
  slowBudget = null;

  check(String(rB).startsWith('B-rejected'), `op B is abandoned by the bound (got ${String(rB).slice(0, 45)})`);
  // The witness: was a budget load still in flight at the moment a raw write executed? Sampled from
  // inside the write stub, because a check before or after the drain cannot see it.
  // THE GUARANTEE, stated as what must never happen rather than as one particular good outcome.
  // Op A may legitimately either wait for the abandoned load and then write, or fail closed when
  // that wait exceeds the bound. In this configuration B's load outlives the bound, so A fails
  // closed, which is #393's contract. What must NEVER happen is A executing a raw write while a
  // load is still in flight: that write can land in whatever budget the abandoned load opens.
  check(
    pendingAtWrite !== true,
    `no raw write ran while a budget load was still pending (pendingAtWrite=${pendingAtWrite}, A=${String(rA).slice(0, 40)})`,
  );
  check(
    String(rA).startsWith('A-rejected'),
    `and A failed CLOSED rather than writing anyway (got ${String(rA).slice(0, 45)})`,
  );
  apiState._clearPendingBudgetLoadsForTests();
}

// --- (8) the test-only registry hook must stay test-only --------------------
// `_clearPendingBudgetLoadsForTests` clears the registration set #393 depends on. There is
// deliberately no production unregister: an entry leaves only when its promise settles, which is
// what makes "is a load outstanding" mean anything. A src/ caller would silently reintroduce the
// leak the whole #393 chain exists to close.
describe('(8) _clearPendingBudgetLoadsForTests has no src/ caller');
{
  const { readdirSync: rd, statSync: st, readFileSync: rf } = await import('node:fs');
  const { join: jn, dirname: dn } = await import('node:path');
  const { fileURLToPath: f2p } = await import('node:url');
  const SRC = jn(dn(f2p(import.meta.url)), '..', '..', 'src');
  const hits = [];
  (function walk(dir) {
    for (const e of rd(dir)) {
      const full = jn(dir, e);
      if (st(full).isDirectory()) walk(full);
      else if (e.endsWith('.ts')) {
        rf(full, 'utf8').split('\n').forEach((line, i) => {
          if (/_clearPendingBudgetLoadsForTests\s*\(/.test(line) && !/^\s*(\*|\/\/)/.test(line) && !/export function\s+_clearPendingBudgetLoadsForTests/.test(line)) {
            hits.push(`${full.replace(SRC, 'src')}:${i + 1}`);
          }
        });
      }
    }
  })(SRC);
  check(hits.length === 0, `no production caller clears the abandoned-load registry (found: ${hits.join(', ') || 'none'})`);
}

log(`\n[#390-abandon] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
