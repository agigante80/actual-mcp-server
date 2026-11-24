// #755: the four legacy search tools say when more rows matched than `limit` returned.
//
// count and totalAmount keep covering the returned rows; hasMore compares the matches with the returned slice.
// Each tool is driven with three matching rows and limit 1 (truncated), limit 3 (exact fit) and
// limit 100 (fewer than the limit), and with the empty results, so a hasMore taken from the
// sliced list (or left off an early return) fails here.
//
// Run: node tests/unit/search_has_more.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit755';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#755] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const FOOD = 'bbbbbbbb-0000-4000-8000-000000000002';
const PAY = 'cccccccc-0000-4000-8000-000000000003';

// Three Food rows of -1000 for one payee in March 2019.
const rows = () => [1, 2, 3].map((n) => ({
  id: `t${n}`, account: ACC, date: `2019-03-0${n}`, amount: -1000, category: FOOD, payee: PAY, notes: null,
}));

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2019-03'];
api.getAccounts = async () => [{ id: ACC, name: 'Checking', offbudget: false, closed: false }];
api.getCategories = async () => [{ id: FOOD, name: 'Food' }];
api.getPayees = async () => [{ id: PAY, name: 'Shop' }];
// Honour the range the adapter passes, so a range with no rows yields an empty listing.
api.getTransactions = async (_acc, start, end) => rows().filter((t) => (!start || t.date >= start) && (!end || t.date <= end));
api.runBankSync = async () => {};
api.runQuery = async () => ({ data: [] });

const apiState = await import('../../dist/src/lib/apiState.js');
apiState.setApiInitialized(true);
apiState.setLoadedBudgetSyncId('budget-A');

const load = async (name) => (await import(`../../dist/src/tools/${name}.js`)).default;
const range = { startDate: '2019-03-01', endDate: '2019-03-31' };

const cases = [
  ['actual_transactions_search_by_amount', 'transactions_search_by_amount', { absoluteAmount: 1000, ...range }, { absoluteAmount: 1000, ...range, categoryName: 'Nope' }],
  ['actual_transactions_search_by_category', 'transactions_search_by_category', { categoryName: 'Food', ...range }, { categoryName: 'Nope', ...range }],
  ['actual_transactions_search_by_month', 'transactions_search_by_month', { month: '2019-03' }, { month: '2019-03', payeeName: 'Nope' }],
  ['actual_transactions_search_by_payee', 'transactions_search_by_payee', { payeeName: 'Shop', ...range }, { payeeName: 'Nope', ...range }],
];

for (const [label, file, input, unknownInput] of cases) {
  describe(label);
  const tool = await load(file);
  const cut = await tool.call({ ...input, limit: 1 });
  check(cut.count === 1 && cut.hasMore === true, `limit 1 of 3 returns count 1 and hasMore true (${cut.count}, ${cut.hasMore})`);
  check(cut.totalAmount === -1000, `totalAmount still covers only the returned rows (${cut.totalAmount})`);
  const exact = await tool.call({ ...input, limit: 3 });
  check(exact.count === 3 && exact.hasMore === false, `limit equal to the matches is not truncated (${exact.count}, ${exact.hasMore})`);
  check(exact.totalAmount === -3000, `totalAmount covers the three rows (${exact.totalAmount})`);
  const wide = await tool.call({ ...input, limit: 100 });
  check(wide.count === 3 && wide.hasMore === false, `fewer matches than the limit is not truncated (${wide.hasMore})`);
  const dflt = await tool.call({ ...input });
  check(dflt.hasMore === false, 'the default limit of 100 over three rows is not truncated');
  const unknown = await tool.call({ ...unknownInput });
  check(unknown.count === 0 && unknown.hasMore === false && typeof unknown.error === 'string', `an unknown name keeps its error result and carries hasMore false (${JSON.stringify(unknown.hasMore)})`);
}

describe('empty results carry hasMore false');
{
  const empty = { startDate: '2020-01-01', endDate: '2020-01-31' };
  for (const [label, file, input] of cases) {
    const tool = await load(file);
    const r = await tool.call({ ...input, ...empty, ...(input.month ? { month: '2020-01' } : {}) });
    check(r.count === 0 && r.hasMore === false, `${label}: no rows gives count 0 and hasMore false (${JSON.stringify(r).slice(0, 160)})`);
  }
}

describe('limit -1 with no matches reports hasMore false (the slice is empty)');
{
  const empty = { startDate: '2020-01-01', endDate: '2020-01-31' };
  for (const [label, file, input] of cases) {
    const tool = await load(file);
    const r = await tool.call({ ...input, ...empty, ...(input.month ? { month: '2020-01' } : {}), limit: -1 });
    check(r.count === 0 && r.hasMore === false, `${label}: limit -1 and no rows gives count 0 and hasMore false (${r.count}, ${r.hasMore})`);
  }
}

log(`\n[#755] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
