// #799: the per-drain listing cache (#378) must not outlive a budget load inside the drain.
//
// THE BUG. A write drain can hold operations of sessions on different budgets, and
// `ensureLoadedBudgetMatchesSession` loads the next operation's budget between two of them. The
// cache is keyed only by listing kind, and a listing-preserving write (addTransactions) leaves it
// in place, so a guard for an operation on budget B read budget A's listing: a valid id of B was
// refused, or an id existing only in A was accepted for a write into B.
//
// The real precondition must run, so `_setSkipApiInitForTests` stays OFF here (the skip flag
// short-circuits the load and the test would pass for no reason).
//
// Run: node tests/unit/adapter_drain_listing_budget_switch.test.js

process.env.ACTUAL_SERVER_URL = 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD = 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit799';
process.env.BUDGET_1_NAME = 'alpha'; process.env.BUDGET_1_SYNC_ID = 'budget-A';
process.env.BUDGET_2_NAME = 'beta';  process.env.BUDGET_2_SYNC_ID = 'budget-B';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#799] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ACC_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let loaded = null;
let accountReads = 0;
let failNextDownloadOf = null;
let writes = [];
let poisonAfterAWrite = false;

let inits = 0; api.init = async () => { inits++; };
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async (id) => {
  if (failNextDownloadOf === id) { failNextDownloadOf = null; loaded = null; throw new Error('download exploded'); }
  loaded = id;
};
api.getBudgetMonths = async () => { if (!loaded) throw { type: 'APIError', message: 'No budget file is open' }; return ['2026-01']; };
api.getAccounts = async () => { accountReads++; return [{ id: loaded === 'budget-A' ? ACC_A : ACC_B, name: 'x' }]; };
api.addTransactions = async (acc) => {
  writes.push([loaded, acc]);
  if (poisonAfterAWrite && loaded === 'budget-A') { poisonAfterAWrite = false; apiState.setApiInitialized(false); }
  return 'ok';
};

const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const apiState = await import('../../dist/src/lib/apiState.js');

const tx = (a) => [{ account: a, date: '2026-01-01', amount: -100 }];
const as = (sid, acc) => requestContext.run({ sessionId: sid }, () => adapter.addTransactions(tx(acc)))
  .then(() => 'ok', (e) => String(e && e.message));
const reset = async () => {
  // Leave the singleton on budget B (session B switched last), with fresh counters.
  await requestContext.run({ sessionId: 'sess-B' }, () => adapter.switchBudget('beta'));
  accountReads = 0; writes = [];
};

await connectionPool.getConnection('sess-A');
await connectionPool.getConnection('sess-B');

describe('(1) A then B in one drain, singleton on B: each guard reads its own budget');
{
  await reset();
  const [a, b] = await Promise.all([as('sess-A', ACC_A), as('sess-B', ACC_B)]);
  check(a === 'ok', `A's write succeeds (got ${a})`);
  check(b === 'ok', `B's valid account is not refused (got ${b})`);
  check(accountReads === 2, `the accounts listing was read twice (got ${accountReads})`);
  check(JSON.stringify(writes) === JSON.stringify([['budget-A', ACC_A], ['budget-B', ACC_B]]),
    `each write landed in its own budget (got ${JSON.stringify(writes)})`);
}

describe('(2) the dangling direction: B writes to an id that exists only in A');
{
  await reset();
  const [a, b] = await Promise.all([as('sess-A', ACC_A), as('sess-B', ACC_A)]);
  check(a === 'ok', `A's write succeeds (got ${a})`);
  check(/Account ".*" not found/.test(b), `B is refused with a not-found message (got ${b})`);
  check(!writes.some(([bud, acc]) => bud === 'budget-B' && acc === ACC_A), "nothing was written into B for A's account");
}

describe('(3) two operations on one budget in one drain still share one listing read (#378)');
{
  await reset();
  const [x, y] = await Promise.all([as('sess-B', ACC_B), as('sess-B', ACC_B)]);
  check(x === 'ok' && y === 'ok', 'both writes succeed');
  check(accountReads === 1, `the accounts listing was read once (got ${accountReads})`);
}

// This case cannot tell the finally in loadBudgetOnItsServer from the reload that follows a failed load
// (the failed load records no loaded budget, so the next operation reloads and drops the cache anyway).
// It pins the outcome: after a failed load of B, an operation for A never reads a listing cached before it.
describe('(4) after a failed load of B the next operation re-reads the listing');
{
  await reset();
  // Singleton on B. A's write loads A (cache filled for A); B's load then rejects; A writes again.
  failNextDownloadOf = 'budget-B';
  const [a, b, a2] = await Promise.all([as('sess-A', ACC_A), as('sess-B', ACC_B), as('sess-A', ACC_A)]);
  check(a === 'ok', `A's first write succeeds (got ${a})`);
  check(b !== 'ok', `B's write is refused for the load error (got ${b})`);
  check(a2 === 'ok', `a later write on A succeeds (got ${a2})`);
  check(accountReads === 2, `the later guard re-read the listing after the failed load (got ${accountReads})`);
}

describe('(5) the re-init branch: a singleton poisoned between two operations of one drain');
{
  await reset();
  inits = 0;
  // A's write leaves the singleton torn down (as a failed session open does); B's operation then
  // takes the !isApiInitialized() branch, which also loads a budget.
  poisonAfterAWrite = true;
  const [a, b] = await Promise.all([as('sess-A', ACC_A), as('sess-B', ACC_B)]);
  check(a === 'ok', `A's write succeeds (got ${a})`);
  check(inits >= 1, `the re-init branch really ran (api.init calls: ${inits})`);
  check(b === 'ok', `B's valid account is not refused after a re-init (got ${b})`);
  check(accountReads === 2, `the accounts listing was read twice (got ${accountReads})`);
}

log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
