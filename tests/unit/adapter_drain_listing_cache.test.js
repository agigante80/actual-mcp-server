// #378: per-drain listing memoisation, and the sibling-operation ordering property.
//
// WHY THIS FILE EXISTS. Every read-then-write guard the adapter gained in #356, #359, #360,
// #361 and #371 opens with a full entity listing. Two consequences were reported, and a third
// was found while reproducing them:
//
//   1. COST. A guarded write pays an O(n) listing inside the api mutex. Reproduced before the
//      fix: two guarded updates in ONE drain cost TWO listings.
//   2. FALSE NOT-FOUND. A create and an update in the same drain raced, so the update could be
//      refused for an entity the sibling had just created.
//   3. THE GUARD FAILING OPEN, which the ticket did not mention and which is the serious one.
//      A delete and an update of the SAME entity in one drain: the update's pre-read saw the
//      entity, the guard passed, and the raw write then ran against a deleted row. Per #360
//      the CRDT apply path INSERTs when the row is absent, so that is the phantom partial row
//      the guard exists to prevent. It reproduced at EVERY timing, including a zero-delay
//      delete, so it did not depend on a lucky interleaving.
//
// THE TWO MECHANISMS ARE NOT INTERCHANGEABLE, which is the thing to keep straight when
// editing this. Memoisation makes the reads cheap and mutually consistent. It does NOT order
// them, and 2 and 3 are ordering problems: a read that happens before a sibling's write is
// equally wrong whether it came from a cache or the database. Sequential dispatch is what
// fixes those. Deleting either mechanism silently reopens one class, so both are pinned here.
//
// Run: node tests/unit/adapter_drain_listing_cache.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = 'unit-test-sync-id';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#378] ${l}`);
const check = (cond, msg) => { if (cond) { log(`  PASS: ${msg}`); passed++; } else { log(`  FAIL: ${msg}`); failed++; } };

const PAYEE = 'pppppppp-0000-4000-8000-000000000001';
const NEW_PAYEE = 'pppppppp-0000-4000-8000-000000000002';
const ACCOUNT = 'aaaaaaaa-0000-4000-8000-000000000001';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

// Mutable fixture state, reset per case.
let payees, accounts, getPayeesCalls, getAccountsCalls, updatePayeeCalls, createDelayMs;

api.sync = async () => {};
api.getPayees = async () => { getPayeesCalls++; return payees.map((p) => ({ ...p })); };
// Failures are injected through a COUNTER this original stub reads, never by reassigning
// `api.getAccounts` later. The adapter destructures the raw functions at module load
// (`const { getAccounts: rawGetAccounts } = api`), so a stub installed after the import is
// simply never called, and a test built that way passes for no reason. That trap already cost
// this repo a vacuous case here in review round 1.
let injectListingFailures = 0;
api.getAccounts = async () => {
  getAccountsCalls++;
  if (injectListingFailures > 0) { injectListingFailures--; throw new Error('transient listing failure'); }
  return accounts.map((a) => ({ ...a }));
};
api.updatePayee = async (id, fields) => {
  updatePayeeCalls.push(id);
  const p = payees.find((p) => p.id === id);
  if (p) Object.assign(p, fields);
};
api.createPayee = async (payee) => {
  if (createDelayMs) await new Promise((r) => setTimeout(r, createDelayMs));
  payees.push({ id: NEW_PAYEE, ...payee });
  return NEW_PAYEE;
};
api.deletePayee = async (id) => { payees = payees.filter((p) => p.id !== id); };
// Entry recording lives in the ORIGINAL stub for the same reason as getAccounts above: a
// replacement installed after the adapter import is never called. The first draft of case (7)
// made exactly that mistake and recorded nothing.
let entryLog = null;
let slowFirstOpMs = 0;
api.addTransactions = async (_accountId, txs) => {
  if (entryLog) {
    const n = Math.abs(txs[0].amount);
    // Record ENTRY and EXIT. Entry order alone does not discriminate: under concurrent
    // dispatch every op still reaches the raw call in array order, because they take the same
    // number of microtask hops and the delay lands AFTER entry. What only sequential dispatch
    // can produce is strict NESTING, where op k+1 cannot enter until op k has left.
    entryLog.push(`in${n}`);
    if (n === 1 && slowFirstOpMs) await new Promise((r) => setTimeout(r, slowFirstOpMs));
    entryLog.push(`out${n}`);
  }
  return 'ok';
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
adapterMod._setSkipApiInitForTests(true);

function reset() {
  payees = [{ id: PAYEE, name: 'Existing' }];
  accounts = [{ id: ACCOUNT, name: 'Checking' }];
  getPayeesCalls = 0; getAccountsCalls = 0; updatePayeeCalls = []; createDelayMs = 0;
}

// ---------------------------------------------------------------------------
describe('(1) a listing read twice in one drain hits the API once');
{
  reset();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  // Transaction writes cannot change the ACCOUNTS listing, so the guard's accounts read is
  // memoised across the batch. This is the annotation's whole purpose.
  await Promise.all(
    Array.from({ length: 10 }, () =>
      adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -100 }])),
  );
  const drains = adapterMod._getWriteQueueBatchCountForTests() - before;
  check(drains === 1, `the 10 writes coalesced into ONE drain (got ${drains})`);
  check(getAccountsCalls === 1, `10 guarded writes paid ONE accounts listing (got ${getAccountsCalls})`);
}

// ---------------------------------------------------------------------------
describe('(2) a write INVALIDATES the listing it can change, so the cache cannot go stale');
{
  reset();
  // Payee updates DO change the payee listing, so each guard must re-read. This asserts the
  // fail-safe direction: we would rather pay N listings than serve one stale view.
  await Promise.all(
    Array.from({ length: 5 }, (_, i) => adapter.updatePayee(PAYEE, { name: `N${i}` })),
  );
  check(getPayeesCalls === 5, `5 payee updates re-read the listing each time (got ${getPayeesCalls})`);
}

// ---------------------------------------------------------------------------
describe('(3) THE DANGEROUS ONE: a create then an update of the same entity in one drain');
{
  for (const delay of [0, 1, 5]) {
    reset();
    createDelayMs = delay;
    let outcome = 'succeeded';
    const create = adapter.createPayee({ name: 'Fresh' });
    const update = adapter.updatePayee(NEW_PAYEE, { name: 'Renamed' })
      .catch((e) => { outcome = e?.message || String(e); });
    await Promise.all([create, update]);
    check(outcome === 'succeeded',
      `create then update of the SAME payee succeeds with a ${delay}ms write (got: ${outcome})`);
  }
}

// ---------------------------------------------------------------------------
describe('(4) THE CORRECTNESS HOLE: a delete then an update must NOT write to the deleted row');
{
  for (const delay of [0, 1, 5]) {
    reset();
    createDelayMs = delay;
    let refused = false;
    const del = adapter.deletePayee(PAYEE).catch(() => {});
    const upd = adapter.updatePayee(PAYEE, { name: 'Renamed' }).catch((e) => {
      refused = /not found/i.test(e?.message || '');
    });
    await Promise.all([del, upd]);
    check(refused, `the update is REFUSED after a same-drain delete (${delay}ms)`);
    check(!updatePayeeCalls.includes(PAYEE),
      `rawUpdatePayee never ran against the deleted payee (${delay}ms), so no phantom row`);
  }
}

// ---------------------------------------------------------------------------
describe('(5) the cache cannot outlive its drain');
{
  reset();
  await adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -1 }]);
  const afterFirst = getAccountsCalls;
  // A SEPARATE drain must not reuse the previous drain's listing. This is the scoping rule
  // that keeps one session from ever seeing another session's or another budget's data.
  await adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-02', amount: -1 }]);
  check(getAccountsCalls === afterFirst + 1,
    `a second drain re-read the listing rather than reusing the first drain's (got ${getAccountsCalls})`);
}

// ---------------------------------------------------------------------------
describe('(6) a failed listing is NOT cached, so retry can still re-fetch it');
{
  reset();
  injectListingFailures = 1;
  // WHY THIS BRANCH IS LOAD BEARING. `retry` wraps `readDrainListing`, not the other way
  // round, so every retry attempt re-enters the cache. If a REJECTED promise stayed cached,
  // retry would keep receiving the same rejection and burn all its attempts without ever
  // issuing a second fetch: one transient ECONNRESET would fail the whole drain instead of
  // recovering. Deleting the error-path `delete` in readDrainListing must turn this red.
  const results = await Promise.allSettled([
    adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -1 }]),
    adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-02', amount: -1 }]),
  ]);
  check(results[0].status === 'fulfilled',
    `retry re-fetched rather than inheriting its own cached rejection (got ${results[0].status})`);
  check(results[1].status === 'fulfilled',
    `the sibling did not inherit the failure (got ${results[1].status})`);
  check(getAccountsCalls === 2,
    `one failure plus one retry, and the sibling served from cache (got ${getAccountsCalls} raw calls)`);
  check(injectListingFailures === 0, 'the injected failure was actually consumed by the raw stub');
}

describe('(7) operations ENTER the api in enqueue order, which is what makes a guard hold');
{
  reset();
  const entered = [];
  entryLog = entered;
  slowFirstOpMs = 20;
  // Record ENTRY into the raw call, not settlement, and make the first op slow so that a
  // concurrent dispatch would visibly reorder. The previous version watched `.then()` order
  // across four identical fast ops sharing one cached listing, so it reported enqueue order
  // under CONCURRENT dispatch too: the assertion whose whole purpose was to pin the ordering
  // fix could not detect its loss.
  const mk = (n) => adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -n }]);
  await Promise.all([mk(1), mk(2), mk(3), mk(4)]);
  entryLog = null;
  slowFirstOpMs = 0;
  check(entered.join(',') === 'in1,out1,in2,out2,in3,out3,in4,out4',
    `each op completed before the next entered, despite a slow first op (got ${entered.join(',')})`);
}

// ---------------------------------------------------------------------------
describe('(8) a drain keeps its own session alive while it runs');
{
  reset();
  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  const sessionId = 'drain-liveness-session';
  // A session whose clock is already stale enough for the idle sweep to want it.
  connectionPool.connections.set(sessionId, {
    sessionId, initialized: true, lastActivity: Date.now() - 60_000, dataDir: '/tmp/test',
  });
  const stale = connectionPool.connections.get(sessionId).lastActivity;

  await requestContext.run({ sessionId }, async () => {
    await Promise.all(Array.from({ length: 3 }, () =>
      adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -1 }])));
  });

  const fresh = connectionPool.connections.get(sessionId)?.lastActivity;
  // WHY. connectionPool.touch() is driven by inbound HTTP requests, not by write ops, so
  // lastActivity does not advance during a drain. Sequential dispatch made a drain's wall
  // clock the SUM of its ops rather than the MAX, so a slow batch can outlive
  // SESSION_IDLE_TIMEOUT_MINUTES and be swept mid-drain. The sweep's shutdownConnection
  // calls api.shutdown() WITHOUT holding withApiLock, tearing the singleton down under an
  // in-flight operation.
  check(typeof fresh === 'number' && fresh > stale,
    `the drain refreshed its session's idle clock (stale=${stale}, fresh=${fresh})`);
  connectionPool.connections.delete(sessionId);
}

log(`\n[#378] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
