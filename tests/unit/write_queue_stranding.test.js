// #414, #389 and #417: what a stalled operation costs the rest of its batch, and how the batch is
// scheduled.
//
// #406 gave each operation in a drain its own abandoned-load wait, because #393's wait happens at
// lock ACQUISITION and a drain acquires once for N operations. Correct, and it has a cost: the wait
// is re-paid per operation, so a stuck load makes every remaining operation fail identically after
// its own bound, holding the process-global mutex for N times that bound.
//
// THE SHAPE MATTERS, and the first version of this file got it wrong. With a load that is ALREADY
// stuck when the drain starts, the drain never enters its loop: the lock acquisition itself fails
// (#393) and the batch is rejected wholesale, so the per-operation path never runs. Timing was then
// identical with and without the fix, which is a test that cannot fail. The reachable shape is a
// load that becomes stuck DURING the batch.
//
// Run: node tests/unit/write_queue_stranding.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit414';
process.env.ACTUAL_OP_TIMEOUT_MS = '250';
process.env.BUDGET_1_NAME = 'alpha';
process.env.BUDGET_1_SYNC_ID = 'budget-A';
process.env.BUDGET_2_NAME = 'beta';
process.env.BUDGET_2_SYNC_ID = 'budget-B';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#414/#389/#417-drain] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let loaded = 'budget-A';
let slowBudget = null;
let downloadDelayMs = 0;
api.init = async () => {};
api.shutdown = async () => { loaded = null; };
api.sync = async () => {};
api.downloadBudget = async (id) => {
  loaded = null;
  if (downloadDelayMs && (slowBudget === null || slowBudget === id)) {
    await new Promise((r) => setTimeout(r, downloadDelayMs));
  }
  loaded = id;
};
api.getBudgetMonths = async () => {
  if (!loaded) throw { type: 'APIError', message: 'No budget file is open' };
  return ['2026-01'];
};
api.addTransactions = async () => 'ok';

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
const { resolveBatchBudget } = adapterMod;
const apiState = await import('../../dist/src/lib/apiState.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');

const write = (sid, amount) => requestContext.run({ sessionId: sid }, () =>
  adapter.addTransactions([{ account: ACC, date: '2026-01-01', amount }]));

// Map the sessions to budgets once, while everything is fast.
await requestContext.run({ sessionId: 'sB' }, () => adapter.switchBudget('beta')).catch(() => {});
for (const sid of ['sA1', 'sA2', 'sA3']) {
  await requestContext.run({ sessionId: sid }, () => adapter.switchBudget('alpha')).catch(() => {});
}

// --- what this file does NOT assert, and why ------------------------------
// Two properties of #414's fail-fast are deliberately unpinned here, both for the same reason.
//
// 1. That the condition is RE-CHECKED rather than latched. Review round 1 correctly noted that
//    latching it leaves the suite green. The mid-batch landing that distinguishes them is not
//    reachable: once the first operation's wait times out, the remaining operations reach their
//    check within microseconds, so a load landing even 70ms later is still pending for all of them,
//    and making it land sooner means it is never abandoned.
// 2. That a HEALTHY batch is untouched by the fail-fast. This one cannot be asserted in this
//    harness at all: a plain three-write batch times out here regardless of the fail-fast, which is
//    #418 (pre-existing, verified identical on v0.16.8 with this batch stashed).
//
// Both become testable once #418 is resolved, and the assertions belong here when it is. Writing
// them now would pin the bug rather than the behaviour.

// --- #414: the cost of a load abandoned mid-batch --------------------------
describe('#414: a load abandoned mid-batch costs the batch ONE bound, not one per operation');
{
  apiState._clearPendingBudgetLoadsForTests();
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');
  loaded = 'budget-A';

  // Only budget-B is slow, and slow enough to outrun the bound, so the FIRST operation abandons its
  // re-select while the operations behind it are still queued in the same drain.
  slowBudget = 'budget-B';
  downloadDelayMs = 900;

  const started = Date.now();
  const results = await Promise.all([
    write('sB', -1).then(() => 'ok', () => 'rejected'),
    write('sA1', -2).then(() => 'ok', () => 'rejected'),
    write('sA2', -3).then(() => 'ok', () => 'rejected'),
    write('sA3', -4).then(() => 'ok', () => 'rejected'),
  ]);
  const elapsed = Date.now() - started;
  downloadDelayMs = 0;
  slowBudget = null;

  const bound = Number(process.env.ACTUAL_OP_TIMEOUT_MS);
  check(results[0] === 'rejected', `the operation whose load was abandoned fails (${results.join(',')})`);
  check(
    elapsed < bound * 3,
    `the batch costs about one bound, not one per operation (elapsed ${elapsed}ms, bound ${bound}ms)`,
  );

  await new Promise((r) => setTimeout(r, 1000));   // let the abandoned download land
  apiState._clearPendingBudgetLoadsForTests();
}

// --- #417: the unanimity rule ---------------------------------------------
// #391 made an unhinted waiter a BARRIER affinity may not cross, specifically to protect the write
// drain. #417 removes the drain from that protected set whenever the batch is unanimous, which is
// the common case, so the rule that decides it needs pinning.
describe('#417: a batch hints its budget only when every operation agrees');
{
  const unanimous = [{ requestStore: { sessionId: 'sA1' } }, { requestStore: { sessionId: 'sA2' } }];
  check(
    resolveBatchBudget(unanimous) === 'budget-A',
    `a unanimous batch hints its budget (got ${resolveBatchBudget(unanimous)})`,
  );

  const mixed = [{ requestStore: { sessionId: 'sA1' } }, { requestStore: { sessionId: 'sB' } }];
  check(
    resolveBatchBudget(mixed) === undefined,
    `a batch spanning two budgets hints NOTHING, so it stays a barrier (got ${resolveBatchBudget(mixed)})`,
  );

  // An entry with no captured store falls back to the env default, which is budget-A here, so a
  // batch of those is still unanimous. What must never happen is a mixed batch producing a hint.
  const withEmpty = [{ requestStore: undefined }, { requestStore: { sessionId: 'sB' } }];
  check(resolveBatchBudget(withEmpty) === undefined, 'a batch mixing a default-resolving entry with another budget hints nothing');
}

log(`\n[#414/#389/#417-drain] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
