// #389: with ACTUAL_OP_TIMEOUT_MS=0, an operation that NEVER STARTS must be rejected, not stranded.
//
// The escape hatch is documented: 0 disables the operation bound for someone debugging against a
// slow upstream. #378 then made the drain SEQUENTIAL, which was necessary for guard atomicity, and
// changed what a stalled operation costs. Before, a hanging op left its siblings running. After,
// operations k+1..N never start, and their residency timers were cleared at dispatch (correct for
// the concurrent model), so nothing rejects them: every caller waits forever and NO ERROR IS
// EMITTED ANYWHERE. That is #278's signature, and #278 took a "flaky" E2E test to surface because
// the only tell was the absence of an error.
//
// This file needs its own process because it must set ACTUAL_OP_TIMEOUT_MS=0 before the config is
// read, and the sibling drain test needs a non-zero bound.
//
// TWO GOTCHAS, both learned the hard way and worth keeping:
//   1. The listing stubs must be installed BEFORE the adapter import. It destructures the raw api
//      functions at module load, so a stub attached afterwards is never called, the real
//      implementation runs inside the drain, and the operation fails for an unrelated reason.
//   2. The stranded timers are unref()d, so a bare harness exits before they fire. Hold a keepalive.
//
// Run: node tests/unit/write_queue_stranded_bound.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit389b';
process.env.ACTUAL_OP_TIMEOUT_MS = '0';        // the escape hatch: the only config where this arms

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#389-stranded] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let loaded = 'budget-A';
let opDelayMs = 0;
let hangFirst = false;
let opIndex = 0;

api.init = async () => {};
api.shutdown = async () => { loaded = null; };
api.sync = async () => {};
api.downloadBudget = async (id) => { loaded = id; };
api.getBudgetMonths = async () => ['2026-01'];
// Installed BEFORE the adapter import: the drain's listing invalidation reaches these, and without
// stubs the real implementations run, throw "No budget file is open", and the operation fails for a
// reason that has nothing to do with what this file tests.
api.getAccounts = async () => [{ id: ACC, name: 'acct', offbudget: false, closed: false }];
api.getCategories = async () => [];
api.getCategoryGroups = async () => [];
api.getPayees = async () => [];
api.addTransactions = async () => {
  const mine = opIndex++;
  if (hangFirst && mine === 0) await new Promise(() => {});   // never settles, on purpose
  if (opDelayMs) await new Promise((r) => setTimeout(r, opDelayMs));
  return 'ok';
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
const { _setStrandedBatchLimitForTests } = adapterMod;
const apiState = await import('../../dist/src/lib/apiState.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');

// The stranded timers are unref()d so they cannot hold a server process open. That means a bare
// test harness exits before they fire, so hold the loop open for the duration.
const keepalive = setInterval(() => {}, 1000);

const write = (sid, amount) => requestContext.run({ sessionId: sid }, () =>
  adapter.addTransactions([{ account: ACC, date: '2026-01-01', amount }]));

_setStrandedBatchLimitForTests(300);
apiState.setApiInitialized(true);
apiState.setLoadedBudgetSyncId('budget-A');
apiState._clearPendingBudgetLoadsForTests();

// --- a healthy but SLOW batch must not reject its own tail -----------------
// This is the case that goes red against the first version of the fix, which armed all N timers at
// dispatch with the same delay. Entry k's allowance was then "the bound minus everything before
// it", so a batch of healthy slow operations rejected its own tail while nothing had stalled.
// Re-arming on each start makes the bound mean "no single PREDECESSOR has run that long".
describe('a healthy slow batch is never rejected, however long the batch takes in total');
{
  opIndex = 0;
  hangFirst = false;
  opDelayMs = 200;   // three of these is 600ms, comfortably past the 300ms bound

  const results = await Promise.all([
    write('s1', -1).then(() => 'ok', (e) => 'rejected: ' + String(e.message).slice(0, 44)),
    write('s2', -2).then(() => 'ok', (e) => 'rejected: ' + String(e.message).slice(0, 44)),
    write('s3', -3).then(() => 'ok', (e) => 'rejected: ' + String(e.message).slice(0, 44)),
  ]);
  opDelayMs = 0;
  check(
    results.every((r) => r === 'ok'),
    `every operation in a slow but healthy batch completes (${results.join(' | ')})`,
  );
}

// --- a genuinely stalled head must reject the tail, not strand it ----------
describe('when the head never returns, the operations behind it are rejected with a reason');
{
  opIndex = 0;
  hangFirst = true;
  apiState._clearPendingBudgetLoadsForTests();

  // The head is fired and NOT awaited: it never settles, which is the whole point. Awaiting it
  // (the first version of this case did) hangs the test rather than testing anything.
  const head = write('s4', -4).then(() => 'ok', (e) => String(e.message));
  void head;
  const tail = await Promise.all([
    write('s5', -5).then(() => 'ok', (e) => String(e.message)),
    write('s6', -6).then(() => 'ok', (e) => String(e.message)),
  ]);
  hangFirst = false;

  check(
    tail.every((r) => /never started/i.test(r)),
    `both queued operations are rejected rather than stranded (${tail.map((r) => r.slice(0, 40)).join(' | ')})`,
  );
  // #278's lesson: the message must not read as a transient upstream stall, or a pooled connection
  // is dropped on a signal that is really "we did not run this".
  check(
    tail.every((r) => !/timed out/i.test(r)),
    'and the message does not claim a timeout, so it is not classed transient',
  );
}

clearInterval(keepalive);
log(`\n[#389-stranded] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
