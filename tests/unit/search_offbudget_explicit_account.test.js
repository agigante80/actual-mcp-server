// #756: an explicit off-budget accountId on actual_transactions_filter, _search_by_category and
// _search_by_month used to return an empty result that reads as "no transactions". The three
// routes exclude off-budget accounts on purpose (#81), so the explicit id is now refused with a
// typed refusal that names the account and the tool that reads it.
//
// Behaviour, not source text: each case drives the real tool against a stubbed upstream api and
// asserts on what comes back (or on the refusal type), and that no transactions were fetched.
//
// Run: node tests/unit/search_offbudget_explicit_account.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit756';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#756] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ON = 'aaaaaaaa-0000-4000-8000-000000000001';
const OFF = 'aaaaaaaa-0000-4000-8000-000000000002';
const UNKNOWN = 'aaaaaaaa-0000-4000-8000-0000000000ff';
const FOOD = 'bbbbbbbb-0000-4000-8000-000000000002';
const PAY = 'cccccccc-0000-4000-8000-000000000003';

const rowsByAccount = {
  [ON]: [{ id: 'on1', account: ON, date: '2019-03-05', amount: -1000, category: FOOD, payee: PAY, notes: null }],
  [OFF]: [
    { id: 'off1', account: OFF, date: '2019-03-06', amount: 500, category: null, payee: PAY, notes: null },
    { id: 'off2', account: OFF, date: '2019-03-07', amount: -200, category: null, payee: PAY, notes: null },
    { id: 'off3', account: OFF, date: '2019-03-08', amount: -300, category: null, payee: PAY, notes: null },
  ],
};

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
let fetched = [];
api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2019-03'];
api.getAccounts = async () => [
  { id: ON, name: 'Checking', offbudget: false, closed: false },
  { id: OFF, name: 'Mortgage', offbudget: true, closed: false },
];
api.getCategories = async () => [{ id: FOOD, name: 'Food' }];
api.getPayees = async () => [{ id: PAY, name: 'Shop' }];
api.getTransactions = async (accountId) => { fetched.push(accountId); return rowsByAccount[accountId] ?? []; };
api.runBankSync = async () => {};
api.runQuery = async () => ({ data: [] });

const apiState = await import('../../dist/src/lib/apiState.js');
apiState.setApiInitialized(true);
apiState.setLoadedBudgetSyncId('budget-A');
const { isPreflightRefusal, NotFoundRefusal, OutOfRangeRefusal } = await import('../../dist/src/lib/errors.js');
const { refuseOffBudgetAccount } = await import('../../dist/src/lib/search-account-guard.js');

const load = async (name) => (await import(`../../dist/src/tools/${name}.js`)).default;
const range = { startDate: '2019-03-01', endDate: '2019-04-30' };
const attempt = async (tool, args) => {
  fetched = [];
  try { return { ok: await tool.call(args) }; } catch (e) { return { err: e }; }
};
const rowsOf = (r) => r.transactions ?? r.result;

const ROUTES = [
  ['transactions_filter', { accountId: OFF, ...range }],
  ['transactions_search_by_category', { accountId: OFF, categoryName: 'Food', ...range }],
  ['transactions_search_by_month', { accountId: OFF, month: '2019-03' }],
];

describe('an explicit off-budget accountId is refused on the three routes');
for (const [name, args] of ROUTES) {
  const tool = await load(name);
  const { err, ok } = await attempt(tool, args);
  check(!!err && isPreflightRefusal(err) && err instanceof OutOfRangeRefusal, `${name}: typed OutOfRangeRefusal (${err ? err.constructor.name : 'returned ' + JSON.stringify(ok).slice(0, 40)})`);
  check(!!err && err.message.includes(OFF) && err.message.includes('actual_transactions_get'), `${name}: message names the account id and actual_transactions_get`);
  check(!!err && err.message === `Account ${OFF} is off-budget, and this search excludes off-budget accounts (their transactions cannot carry categories). Use actual_transactions_get to read it.`, `${name}: exact message`);
  check(fetched.length === 0, `${name}: no transactions were fetched (${fetched.join(',')})`);
}

describe('NEGATIVE: an on-budget id and no id behave as before');
for (const [name, args] of ROUTES) {
  const tool = await load(name);
  const onArgs = { ...args, accountId: ON };
  const a = await attempt(tool, onArgs);
  check(!a.err, `${name}: the on-budget id is accepted (${a.err ? a.err.message : 'ok'})`);
  const { accountId: _drop, ...noId } = args;
  const b = await attempt(tool, noId);
  check(!b.err, `${name}: no accountId is accepted (${b.err ? b.err.message : 'ok'})`);
}
{
  const tool = await load('transactions_search_by_category');
  const r = await tool.call({ accountId: ON, categoryName: 'Food', ...range });
  check(rowsOf(r).map((t) => t.id).join(',') === 'on1', 'category search on the on-budget account returns its Food row');
}

describe('NEGATIVE: an unknown id keeps its existing answer');
{
  const filter = await load('transactions_filter');
  const r = await attempt(filter, { accountId: UNKNOWN, ...range });
  check(!r.err && Array.isArray(r.ok.result) && r.ok.result.length === 0, 'transactions_filter: an unknown well-formed id still returns { result: [] }');
  for (const [name, args] of ROUTES.slice(1)) {
    const tool = await load(name);
    const x = await attempt(tool, { ...args, accountId: UNKNOWN });
    check(!!x.err && x.err instanceof NotFoundRefusal && !(x.err instanceof OutOfRangeRefusal), `${name}: an unknown id is the not-found refusal, not the off-budget one`);
    check(!!x.err && !x.err.message.includes('off-budget'), `${name}: the not-found message does not mention off-budget`);
  }
}

describe('NEGATIVE: routes that include off-budget accounts are not refused');
{
  const byPayee = await load('transactions_search_by_payee');
  const p = await attempt(byPayee, { accountId: OFF, payeeName: 'Shop', ...range });
  check(!p.err && rowsOf(p.ok).length === 3, `search_by_payee reads the off-budget account (${p.err ? p.err.message : rowsOf(p.ok).length + ' rows'})`);
  const byAmount = await load('transactions_search_by_amount');
  const m = await attempt(byAmount, { accountId: OFF, minAmount: -1000, ...range });
  check(!m.err && rowsOf(m.ok).length === 3, `search_by_amount reads the off-budget account (${m.err ? m.err.message : rowsOf(m.ok).length + ' rows'})`);
  const get = await load('transactions_get');
  const g = await attempt(get, { accountId: OFF });
  check(!g.err, `transactions_get reads the off-budget account (${g.err ? g.err.message : 'ok'})`);
}

describe('the helper alone');
{
  const accounts = [{ id: ON, offbudget: false }, { id: OFF, offbudget: true }, { id: 'no-flag' }];
  const quiet = (id) => { try { refuseOffBudgetAccount(accounts, id); return true; } catch { return false; } };
  check(quiet(undefined), 'undefined returns');
  check(quiet(null), 'null returns');
  check(quiet(''), 'an empty id returns');
  check(quiet(UNKNOWN), 'an id not in the list returns (the not-found path is the caller\'s)');
  check(quiet(ON), 'an on-budget id returns');
  check(quiet('no-flag'), 'an account with no offbudget flag returns');
  let thrown;
  try { refuseOffBudgetAccount(accounts, OFF); } catch (e) { thrown = e; }
  check(!!thrown && isPreflightRefusal(thrown) && thrown.value === OFF, 'an off-budget id throws a preflight refusal carrying the id');
}

log(`\n[#756] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
