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
api.getAccounts = async () => { getAccountsCalls++; return accounts.map((a) => ({ ...a })); };
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
api.addTransactions = async () => 'ok';

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
describe('(6) a failed listing is not cached for the rest of the drain');
{
  reset();
  let firstCall = true;
  const good = api.getAccounts;
  api.getAccounts = async () => {
    getAccountsCalls++;
    if (firstCall) { firstCall = false; throw new Error('transient listing failure'); }
    return accounts.map((a) => ({ ...a }));
  };
  const results = await Promise.allSettled([
    adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -1 }]),
    adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-02', amount: -1 }]),
  ]);
  api.getAccounts = good;
  // The retry wrapper may absorb the first failure; what must NOT happen is the second
  // operation inheriting a cached rejection and being refused for its sibling's reason.
  check(results[1].status === 'fulfilled',
    `the second op did not inherit the first op's listing failure (got ${results[1].status})`);
}

// ---------------------------------------------------------------------------
describe('(7) operations dispatch in ENQUEUE ORDER, which is what makes a guard hold');
{
  reset();
  const order = [];
  const mk = (n) => adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -n }])
    .then(() => order.push(n));
  await Promise.all([mk(1), mk(2), mk(3), mk(4)]);
  check(order.join(',') === '1,2,3,4', `settled in enqueue order (got ${order.join(',')})`);
}

log(`\n[#378] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
