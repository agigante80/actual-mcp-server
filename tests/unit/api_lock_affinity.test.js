// #391: budget affinity in the api mutex, and the three properties that make it safe.
//
// The problem, measured on v0.16.6 and again on v0.16.7: two sessions on different budgets doing
// 20 alternating tool calls produced 19 full budget downloads, 19 syncs of the outgoing budget and
// 19 post-condition probes, all serialised through this one mutex. That is #390's isolation
// working correctly and costing a re-selection PER OPERATION. On a large budget the download can
// exceed ACTUAL_OP_TIMEOUT_MS, at which point neither user completes anything while the other is
// active, and two ordinary authenticated accounts can hold the process there deliberately.
//
// Affinity trades strict FIFO for "prefer a waiter whose budget is already loaded", so a run of
// same-budget operations pays ONE re-selection rather than one each. That introduces starvation as
// a failure mode the old lock did not have, which is why the cap is tested rather than assumed.
//
// Run: node tests/unit/api_lock_affinity.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit391';
process.env.ACTUAL_OP_TIMEOUT_MS = '2000';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#391-affinity] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const { withApiLock, _resetApiLockForTests, _getApiLockStateForTests, _setApiLockLogHookForTests } =
  await import('../../dist/src/lib/apiLock.js');
const apiState = await import('../../dist/src/lib/apiState.js');

const tick = () => new Promise((r) => setImmediate(r));

/**
 * Queue N acquisitions behind a held lock, then release it and record the order they ran in.
 * `hold` resolves the initial holder.
 */
async function runQueue(spec) {
  _resetApiLockForTests();
  apiState._clearPendingBudgetLoadsForTests?.();
  const order = [];
  let releaseHolder;
  const holder = withApiLock(() => new Promise((r) => { releaseHolder = r; }));
  await tick();

  const queued = spec.map(({ id, budget }) =>
    withApiLock(async () => { order.push(id); }, { budget }),
  );
  await tick();
  releaseHolder();
  await holder;
  await Promise.all(queued);
  return order;
}

// --- 1. the point of the ticket -------------------------------------------
describe('waiters on the LOADED budget run before older waiters on another budget');
{
  apiState.setLoadedBudgetSyncId('budget-A');
  const order = await runQueue([
    { id: 'B1', budget: 'budget-B' },   // oldest, but on the wrong budget
    { id: 'A1', budget: 'budget-A' },
    { id: 'A2', budget: 'budget-A' },
  ]);
  check(
    order.slice(0, 2).join(',') === 'A1,A2',
    `the loaded budget's waiters go first (order: ${order.join(',')})`,
  );
  check(order[2] === 'B1', 'and the other budget still runs, after them');
}

// --- 2. FIFO WITHIN a budget ----------------------------------------------
// Several correctness arguments elsewhere rest on same-session ordering, so affinity must not
// reorder two operations on the SAME budget.
describe('ordering within one budget is preserved exactly');
{
  apiState.setLoadedBudgetSyncId('budget-A');
  const order = await runQueue([
    { id: 'A1', budget: 'budget-A' },
    { id: 'A2', budget: 'budget-A' },
    { id: 'A3', budget: 'budget-A' },
  ]);
  check(order.join(',') === 'A1,A2,A3', `same-budget waiters keep their order (got ${order.join(',')})`);
}

// --- 3. BOUNDED STARVATION ------------------------------------------------
// The failure mode affinity introduces. Without a cap, a continuously busy budget starves the
// other one forever, which strict FIFO could never do.
describe('a waiter on another budget cannot be starved indefinitely');
{
  _resetApiLockForTests();
  apiState.setLoadedBudgetSyncId('budget-A');
  const order = [];
  let releaseHolder;
  const holder = withApiLock(() => new Promise((r) => { releaseHolder = r; }));
  await tick();

  // The victim: oldest, on the other budget.
  const victim = withApiLock(async () => { order.push('VICTIM'); }, { budget: 'budget-B' });
  // A long run of same-budget work queued behind it.
  const busy = [];
  for (let i = 0; i < 20; i++) {
    busy.push(withApiLock(async () => { order.push('A' + i); }, { budget: 'budget-A' }));
  }
  await tick();
  releaseHolder();
  await holder;
  await Promise.all([victim, ...busy]);

  const victimAt = order.indexOf('VICTIM');
  check(victimAt !== -1, 'the starved waiter eventually runs');
  check(
    victimAt <= 8,
    `and within the documented cap of 8 skips rather than after all 20 (ran at position ${victimAt})`,
  );
}

// --- 4. no affinity hint means plain FIFO ---------------------------------
// A drain whose batch spans budgets passes no hint. That must always be correct, just unoptimised.
describe('waiters with no budget hint are served in strict FIFO order');
{
  apiState.setLoadedBudgetSyncId('budget-A');
  const order = await runQueue([
    { id: 'N1' }, { id: 'N2' }, { id: 'N3' },
  ]);
  check(order.join(',') === 'N1,N2,N3', `unhinted waiters keep FIFO (got ${order.join(',')})`);
}

// --- 5. the mutex is still a mutex ----------------------------------------
describe('only one holder at a time, and the lock is released on a throw');
{
  _resetApiLockForTests();
  apiState.setLoadedBudgetSyncId('budget-A');
  let concurrent = 0;
  let maxConcurrent = 0;
  const body = async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 5));
    concurrent--;
  };
  await Promise.all([
    withApiLock(body, { budget: 'budget-A' }),
    withApiLock(body, { budget: 'budget-B' }),
    withApiLock(body, { budget: 'budget-A' }),
  ]);
  check(maxConcurrent === 1, `never more than one holder (peak ${maxConcurrent})`);

  let threw = false;
  await withApiLock(async () => { throw new Error('boom'); }).catch(() => { threw = true; });
  check(threw, 'a throwing callback rejects');
  const after = _getApiLockStateForTests();
  check(after.held === false && after.waiting === 0, `and the lock is free afterwards (${JSON.stringify(after)})`);
}

// --- 6. the #393 wait still happens on every acquisition ------------------
// Reordering acquisitions must not let one skip the abandoned-load wait.
describe('every acquisition still settles an abandoned budget load first');
{
  _resetApiLockForTests();
  apiState.setLoadedBudgetSyncId('budget-A');
  let landed = false;
  let release;
  const stuck = new Promise((r) => { release = r; }).then(() => { landed = true; });
  apiState.registerBudgetLoad(stuck);
  setTimeout(() => release(), 40);

  let sawLandedInside = null;
  await withApiLock(async () => { sawLandedInside = landed; }, { budget: 'budget-A' });
  check(sawLandedInside === true, `the pending load settled BEFORE the callback ran (saw ${sawLandedInside})`);
  apiState._clearPendingBudgetLoadsForTests();
}

// --- 7. the measured outcome, pinned -------------------------------------
// Not a micro-property this time: the end-to-end number the ticket exists to move. Under
// CONTENTION (the shape the DoS lever describes) a run of same-budget waiters must pay one
// re-selection, not one each.
describe('a contended queue pays re-selections per ALTERNATION, not per call');
{
  _resetApiLockForTests();
  apiState.setLoadedBudgetSyncId('budget-A');
  let switches = 0;
  let loaded = 'budget-A';
  const order = [];

  let releaseHolder;
  const holder = withApiLock(() => new Promise((r) => { releaseHolder = r; }));
  await tick();

  // 20 acquisitions, alternating budgets, ALL queued before any runs.
  const work = [];
  for (let i = 0; i < 20; i++) {
    const budget = i % 2 === 0 ? 'budget-A' : 'budget-B';
    work.push(withApiLock(async () => {
      if (loaded !== budget) { switches++; loaded = budget; apiState.setLoadedBudgetSyncId(budget); }
      order.push(budget);
    }, { budget }));
  }
  await tick();
  releaseHolder();
  await holder;
  await Promise.all(work);

  check(order.length === 20, 'every acquisition ran');
  // Strict FIFO would alternate and switch on all 19 transitions. Affinity groups them.
  check(
    switches <= 4,
    `a contended alternating load costs few re-selections, not one per call (switches=${switches} over 20 calls)`,
  );
}

// --- 8. an UNHINTED waiter is a barrier (the round-1 HIGH) -----------------
// The worst thing in the first version of this change. An unhinted waiter can never equal the
// loaded budget, so it was freely skipped, and the acquisitions with no hint to give are the ones
// least able to afford it: the pool's session open, shutdownAll, and the write drain whenever its
// batch spans two budgets (#417 lets a UNANIMOUS batch hint, which is the common case). On a
// SINGLE-budget deployment, where affinity can never save a re-selection because only one budget
// is ever loaded, a drain enqueued first ran ninth behind eight reads. The majority deployment
// got the reordering and none of the benefit, and a write could be overtaken by reads issued
// after it.
describe('affinity never reorders across an unhinted waiter');
{
  apiState.setLoadedBudgetSyncId('budget-A');
  const order = await runQueue([
    { id: 'DRAIN' },                    // unhinted, oldest: a barrier
    { id: 'A1', budget: 'budget-A' },
    { id: 'A2', budget: 'budget-A' },
  ]);
  check(order[0] === 'DRAIN', `the unhinted waiter is not skipped (order: ${order.join(',')})`);
  check(order.join(',') === 'DRAIN,A1,A2', 'and everything behind it keeps its order');
}

// --- 9. but affinity still works AHEAD of a barrier ------------------------
describe('affinity still applies among waiters queued before an unhinted one');
{
  apiState.setLoadedBudgetSyncId('budget-A');
  const order = await runQueue([
    { id: 'B1', budget: 'budget-B' },
    { id: 'A1', budget: 'budget-A' },   // may overtake B1: both are ahead of the barrier
    { id: 'DRAIN' },
  ]);
  check(order[0] === 'A1', `the loaded budget still wins ahead of the barrier (order: ${order.join(',')})`);
  check(order.indexOf('DRAIN') === 2, 'and the barrier itself is not overtaken');
}

// --- 10. the release path cannot be broken by logging ----------------------
// grantNext runs in a finally. Anything that throws there leaves `held` true with a queue nobody
// will ever be handed, and no timeout can rescue it because the waiters never enter the lock body.
//
// The first version of this case asserted SOURCE-TEXT ordering by reading apiLock.ts. Review
// reintroduced the exact regression a few lines away from the anchors and it stayed green, so it
// was vacuous against the very thing it named. This drives the real code instead, through the
// injectable seam the release path logs behind.
describe('a throwing logger on the release path cannot wedge the lock');
{
  _resetApiLockForTests();
  apiState.setLoadedBudgetSyncId('budget-A');
  _setApiLockLogHookForTests(() => { throw new Error('transport exploded'); });

  const ran = [];
  let releaseHolder;
  const holder = withApiLock(() => new Promise((r) => { releaseHolder = r; }));
  await tick();
  // B first so the grant to A is an out-of-order one, which is the only path that logs.
  const b = withApiLock(async () => { ran.push('B'); }, { budget: 'budget-B' });
  const a = withApiLock(async () => { ran.push('A'); }, { budget: 'budget-A' });
  await tick();
  releaseHolder();
  await holder;
  // BOUNDED. A wedge would otherwise hang the whole suite, and a hang is a terrible failure signal:
  // CLAUDE.md's own line is that a hang has no timeout large enough. Racing it turns the wedge into
  // a legible assertion failure naming what did not run.
  const settled = await Promise.race([
    Promise.all([a, b]).then(() => 'settled'),
    new Promise((r) => setTimeout(() => r('WEDGED'), 1000)),
  ]);

  _setApiLockLogHookForTests(null);
  check(settled === 'settled', `the queue drained rather than wedging (got ${settled}, ran: ${ran.join(',')})`);
  check(ran.length === 2, `both waiters ran despite the logger throwing (ran: ${ran.join(',')})`);
  check(ran[0] === 'A', 'and the out-of-order grant still happened, so the log really was on that path');
  const st = _getApiLockStateForTests();
  check(st.held === false && st.waiting === 0, `the lock is free afterwards (${JSON.stringify(st)})`);
}

// --- 11. a rejected ACQUISITION still releases the lock --------------------
// #392 and #393 each broke this once, in different places.
describe('an acquisition that fails closed still releases the lock');
{
  _resetApiLockForTests();
  apiState.setLoadedBudgetSyncId('budget-A');
  apiState.registerBudgetLoad(new Promise(() => {}));   // never settles: acquisition will throw
  let rejected = false;
  await withApiLock(async () => { /* never reached */ }).catch(() => { rejected = true; });
  apiState._clearPendingBudgetLoadsForTests();
  check(rejected, 'the acquisition rejected');
  const st = _getApiLockStateForTests();
  check(st.held === false && st.waiting === 0, `and the lock is free, not stuck held (${JSON.stringify(st)})`);
}

_resetApiLockForTests();
log(`\n[#391-affinity] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
