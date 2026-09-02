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
// #418: these four are the guard pre-reads, and they MUST be stubbed BEFORE the adapter import,
// which destructures the raw api functions at module load. Without them the real implementations
// run inside the drain against a server that does not exist, and the operation exceeds the bound.
// That is the whole of #418: the reduction blamed a preceding stuck batch, but a CLEAN first
// write with no prior failure fails identically (359ms, same message, same running=1), so the
// prior failure was never causal. Their absence is also what made the healthy-batch assertion
// below look impossible.
api.getAccounts = async () => [{ id: ACC, name: 'acct', offbudget: false, closed: false }];
api.getCategories = async () => [];
api.getCategoryGroups = async () => [];
api.getPayees = async () => [];

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
// The re-checked-rather-than-latched property is now pinned, but only in ONE of its two forms, and
// the distinction is worth stating because the first version of this comment got it wrong by
// calling the whole thing untestable.
//
// WITHIN a drain it remains unreachable: once the first operation's wait times out, the remaining
// operations reach their check within microseconds, so a load landing even 70ms later is still
// pending for all of them, and making it land sooner means it is never abandoned.
//
// ACROSS drains it is covered, by the healthy-batch case below. Mutation-proven in both
// directions, which is what separates the two halves of the condition. Latching `stuckLoadError`
// across drains ALONE keeps every case green, and correctly so: `hasPendingBudgetLoad()` is
// re-read at the check, so a stale error with nothing pending refuses nothing. Latch it AND drop
// that re-read and the healthy batch goes red with all three operations refused. So the re-read
// is the load-bearing half, and this file now fails if someone removes it.
//
// A SECOND property, that a healthy batch is untouched, was unpinned here for a reason that turned
// out to be false, and the correction is the more useful lesson so it stays. This comment used to
// say a plain three-write batch times out here regardless, and filed that as #418. There was no
// such defect: the timeout was the four guard pre-reads running their REAL implementations against
// a server that is not there, because they were never stubbed. The reduction blamed the batch that
// happened to precede it, and the control nobody ran is decisive: with no stuck load and no prior
// failure at all, ONE clean write fails identically, same message and the same running=1 that
// looked like a leaked concurrency slot. A symptom seen right after a failure was attributed to
// that failure on adjacency alone. With the stubs in place the assertion below is cheap.

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

// --- #414: the fail-fast must not touch a HEALTHY batch ---------------------
// The other half of a fail-fast, and the half that is easy to forget: refusing early is only
// correct while something is actually stuck. This is the case the stale #418 comment claimed was
// impossible to write here.
describe('#414: with no stuck load, every operation in a batch still completes');
{
  apiState._clearPendingBudgetLoadsForTests();
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');
  loaded = 'budget-A';
  downloadDelayMs = 0;
  slowBudget = null;

  // All three on the SAME budget, so nothing re-selects and nothing can be abandoned.
  const results = await Promise.all([
    write('sA1', -11).then(() => 'ok', (e) => 'rejected: ' + String(e.message).slice(0, 46)),
    write('sA2', -12).then(() => 'ok', (e) => 'rejected: ' + String(e.message).slice(0, 46)),
    write('sA3', -13).then(() => 'ok', (e) => 'rejected: ' + String(e.message).slice(0, 46)),
  ]);
  check(
    results.every((r) => r === 'ok'),
    `a healthy batch is untouched by the fail-fast (${results.join(' | ')})`,
  );
  check(
    !apiState._hasPendingBudgetLoadForTests(),
    'and it leaves no pending load registered behind it',
  );
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
