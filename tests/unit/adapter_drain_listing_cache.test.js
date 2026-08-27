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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
let poolRef = null;
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

// Mutable fixture state, reset per case.
let payees, accounts, getPayeesCalls, getAccountsCalls, updatePayeeCalls, createDelayMs;
let getCategoriesCalls = 0, getGroupsCalls = 0;

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
// Case (8): sample the POOL CLOCK at each op's entry, from inside the raw call. Asserting
// only that the clock moved by the end of the drain proves a single touch happened SOMEWHERE,
// which a touch hoisted out of the loop satisfies while leaving the hazard fully open.
let clockSamples = null;
let clockSessionId = null;
let everyOpSlowMs = 0;
api.getCategories = async () => { getCategoriesCalls++; return []; };
api.getCategoryGroups = async () => { getGroupsCalls++; return []; };
api.updateNote = async () => {};
api.addTransactions = async (_accountId, txs) => {
  if (clockSamples) {
    const conn = poolRef?.connections.get(clockSessionId);
    clockSamples.push(conn?.lastActivity);
    if (everyOpSlowMs) await new Promise((r) => setTimeout(r, everyOpSlowMs));
  }
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
  getCategoriesCalls = 0; getGroupsCalls = 0;
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
describe('(8) a drain keeps every session in it alive, refreshed PER OP');
{
  reset();
  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  poolRef = connectionPool;
  const sessionId = 'drain-liveness-session';
  clockSessionId = sessionId;
  // A stale clock. Deliberately NOT claiming this is past the sweep threshold: IDLE_TIMEOUT is
  // SESSION_IDLE_TIMEOUT_MINUTES (default 5) times 60000, so a 60s offset is well inside the
  // window. What matters here is only that the clock is old enough to see it move.
  connectionPool.connections.set(sessionId, {
    sessionId, initialized: true, lastActivity: Date.now() - 60_000, dataDir: '/tmp/test',
  });
  const stale = connectionPool.connections.get(sessionId).lastActivity;

  const samples = [];
  clockSamples = samples;
  // The delay is load bearing: without it three ops can enter within the same millisecond and
  // a strictly-increasing assertion becomes flaky rather than discriminating.
  everyOpSlowMs = 15;
  await requestContext.run({ sessionId }, async () => {
    await Promise.all(Array.from({ length: 3 }, () =>
      adapter.addTransactions([{ account: ACCOUNT, date: '2026-01-01', amount: -1 }])));
  });
  clockSamples = null; clockSessionId = null; everyOpSlowMs = 0; poolRef = null;

  const fresh = connectionPool.connections.get(sessionId)?.lastActivity;
  check(typeof fresh === 'number' && fresh > stale,
    `the drain refreshed its session's idle clock at all (stale=${stale}, fresh=${fresh})`);
  // THE ONE THAT PINS THE FIX. Each op must see a clock the PREVIOUS op advanced. A touch
  // hoisted out of the loop leaves all three samples identical and this goes red, while the
  // assertion above stays green.
  const perOp = samples.length === 3 && samples.every((v, i) => i === 0 || v > samples[i - 1]);
  check(perOp, `the clock advanced between ops, not once per drain (samples=${samples.join(',')})`);
  connectionPool.connections.delete(sessionId);
}

// ---------------------------------------------------------------------------
describe('(9) isolation: separate drains never share cached state, and the store is unreachable outside one');
{
  reset();
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  // The scenario #378's re-validation asked for: two sessions, which in a multi-budget
  // deployment are two budgets. Separate drains must not share a listing, or one principal's
  // guard would decide against another principal's entity list.
  //
  // Honest about what this proves: it pins that the cache is never-shared-across-drains, which
  // holds for a module-level cache cleared in a finally as well. It is NOT evidence for the
  // AsyncLocalStorage scoping specifically; the source check below is.
  await requestContext.run({ sessionId: 'session-A' }, () =>
    adapter.addTransactions([{ account: ACCOUNT, date: '2026-02-01', amount: -1 }]));
  const afterA = getAccountsCalls;
  await requestContext.run({ sessionId: 'session-B' }, () =>
    adapter.addTransactions([{ account: ACCOUNT, date: '2026-02-02', amount: -1 }]));
  check(getAccountsCalls === afterA + 1,
    `session B's drain re-read rather than reusing session A's listing (got ${getAccountsCalls})`);

  // The structural claim, asserted against the SOURCE, because it cannot be observed from
  // outside. The previous version of this called adapter.getAccounts() twice and asserted two
  // raw calls, with a comment claiming it would go red if the cache moved back to module
  // scope. It could not: adapter.getAccounts calls rawGetAccounts directly and is not one of
  // the readDrainListing call sites, so it is two raw calls under EVERY implementation.
  // Review proved that by reintroducing a module-level cache and watching the suite stay
  // fully green.
  //
  // A module-level binding is what the regression actually looks like, and that IS checkable.
  const adapterSource = readFileSync(
    fileURLToPath(new URL('../../src/lib/actual-adapter.ts', import.meta.url)), 'utf8');
  const moduleLevelCache = adapterSource
    .split('\n')
    .filter((l) => /^(let|var|const)\s+\w*[Dd]rainListing\w*\s*(:|=)/.test(l))
    .filter((l) => !/AsyncLocalStorage/.test(l));
  check(moduleLevelCache.length === 0,
    `the drain cache has no module-level binding (found: ${moduleLevelCache.join(' | ') || 'none'})`);

  // WHAT THIS DOES NOT CLAIM. Two sessions writing inside ONE drain window DO share that
  // drain, and therefore its cache, because the drain picks one connection from batch[0].
  // That is not a cache defect (they already share the api singleton and its loaded budget)
  // and it is tracked as #390, which is about the drain itself rather than the cache.
}

// ---------------------------------------------------------------------------
describe('(10) ACCEPTANCE (#378): a second note write in one drain pays ZERO listings');
{
  reset();
  // The ticket's own stated worst case: "Given a single actual_notes_update on a
  // non-budget-month id, Then it performs at most four listing reads, and a SECOND note write
  // in the same drain performs zero." v0.16.1 shipped WITHOUT this: updateNote carried no
  // preservesListings annotation, so the fail-safe invalidate-everything default applied and
  // two note writes paid EIGHT listings. Nothing in the suite noticed, which is why this case
  // exists: a lost annotation is only a performance regression, so it is invisible unless
  // something counts.
  await Promise.all([
    adapter.updateNote(ACCOUNT, 'first').catch(() => {}),
    adapter.updateNote(ACCOUNT, 'second').catch(() => {}),
  ]);
  const total = getAccountsCalls + getCategoriesCalls + getGroupsCalls + getPayeesCalls;
  check(total === 4,
    `two note writes in one drain paid FOUR listings, not eight (got ${total}: ` +
    `accounts=${getAccountsCalls} categories=${getCategoriesCalls} ` +
    `groups=${getGroupsCalls} payees=${getPayeesCalls})`);
}

// ---------------------------------------------------------------------------
describe('(11) memoisation survives the concurrency limiter, which does not preserve async context');
{
  reset();
  // Every readDrainListing call site is withConcurrency(() => retry(() => readDrainListing())).
  // withConcurrency queues a PLAIN CLOSURE on a module-level array when saturated and invokes
  // it from another task's .finally(), so the queued task runs in the RELEASING task's async
  // context. An AsyncLocalStorage-scoped cache is therefore only reachable through the limiter
  // by arrangement (the drain holds the api lock, so every limiter task inside it is a
  // drain-context task), not by construction. Squeeze the limiter to 1 so every read after the
  // first is queued, and pin that the memoisation still holds. If it ever stops, the failure is
  // silent (a pass-through: correct but slow), which is exactly the kind that needs a counter.
  const { setMaxConcurrency, getConcurrencySnapshot } =
    await import('../../dist/src/lib/actual-adapter/concurrency.js');
  const previous = getConcurrencySnapshot().maxConcurrency;
  setMaxConcurrency(1);
  try {
    await Promise.all(Array.from({ length: 6 }, () =>
      adapter.addTransactions([{ account: ACCOUNT, date: '2026-03-01', amount: -1 }])));
    check(getAccountsCalls === 1,
      `six guarded writes through a saturated limiter still paid ONE listing (got ${getAccountsCalls})`);
  } finally {
    setMaxConcurrency(previous);
  }
}

log(`\n[#378] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
