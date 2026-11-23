// #750: a search that filters on category or notes must match a split's CHILDREN, not its parent.
//
// Upstream returns a split as one grouped parent (category null) with the children nested in
// `subtransactions`. The five legacy search tools filtered top-level rows only, so a category
// search under-counted and its totalAmount was wrong. This file drives each tool with a grouped
// split and asserts on the rows and totals it returns, so it fails when a tool stops expanding.
//
// Run: node tests/unit/search_split_children.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit750';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#750] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const FOOD = 'bbbbbbbb-0000-4000-8000-000000000002';
const FUN = 'bbbbbbbb-0000-4000-8000-000000000003';
const RENT = 'bbbbbbbb-0000-4000-8000-000000000004';
const PAY = 'cccccccc-0000-4000-8000-000000000003';

// A grouped split of -3000 (children -1000 Food with notes, -2000 Fun without), plus two Food rows.
const grouped = () => [
  { id: 'f1', account: ACC, date: '2019-03-01', amount: -1000, category: FOOD, payee: PAY, notes: 'lunch' },
  { id: 'f2', account: ACC, date: '2019-03-20', amount: 1000, category: FOOD, payee: PAY, notes: null },
  {
    id: 'sp', account: ACC, date: '2019-04-10', amount: -3000, category: null, payee: PAY, notes: 'trip',
    is_parent: true,
    subtransactions: [
      { id: 'c1', amount: -1000, category: FOOD, notes: 'child food', parent_id: 'sp' },
      { id: 'c2', amount: -2000, category: FUN, notes: null, parent_id: 'sp' },
    ],
  },
];

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2019-03'];
api.getAccounts = async () => [{ id: ACC, name: 'Checking', offbudget: false, closed: false }];
api.getCategories = async () => [
  { id: FOOD, name: 'Food' }, { id: FUN, name: 'Fun' }, { id: RENT, name: 'Rent' },
];
api.getPayees = async () => [{ id: PAY, name: 'Splitter' }];
api.getTransactions = async () => grouped();
api.runBankSync = async () => {};
api.runQuery = async () => ({ data: [] });

const apiState = await import('../../dist/src/lib/apiState.js');
apiState.setApiInitialized(true);
apiState.setLoadedBudgetSyncId('budget-A');

const load = async (name) => (await import(`../../dist/src/tools/${name}.js`)).default;
const rowsOf = (r) => r.transactions ?? r.result;
const ids = (r) => rowsOf(r).map((t) => t.id).sort().join(',');
const range = { startDate: '2019-03-01', endDate: '2019-04-30' };

describe('actual_transactions_search_by_category');
{
  const tool = await load('transactions_search_by_category');
  const r = await tool.call({ categoryName: 'Food', ...range });
  check(ids(r) === 'c1,f1,f2', `finds the Food child with the two Food rows (${ids(r)})`);
  check(r.count === 3 && r.totalAmount === -1000, `count 3, totalAmount -1000 (${r.count}, ${r.totalAmount})`);
  const child = rowsOf(r).find((t) => t.id === 'c1');
  check(child?.parent_id === 'sp' && child?.account === ACC && child?.date === '2019-04-10' && child?.payee === PAY,
    'the child carries parent_id and the parent account, date and payee');
  check(child?.accountName === 'Checking', 'the child is enriched with accountName');
  const none = await tool.call({ categoryName: 'Rent', ...range });
  check(none.count === 0 && none.totalAmount === 0, 'a category with no matching child returns nothing, parent included');
  const unknown = await tool.call({ categoryName: 'Nope', ...range });
  check(unknown.count === 0 && unknown.error === 'Category "Nope" not found', 'an unknown category keeps its error result');
  const plain = await tool.call({ ...range });
  check(ids(plain) === 'f1,f2,sp', `without a category the split stays one parent row (${ids(plain)})`);
  check(!('parent_id' in rowsOf(plain).find((t) => t.id === 'sp')), 'the parent row has no parent_id');
}

describe('actual_transactions_search_by_payee');
{
  const tool = await load('transactions_search_by_payee');
  const r = await tool.call({ payeeName: 'Splitter', categoryName: 'Food', ...range });
  check(ids(r) === 'c1,f1,f2', `payee plus category finds the child (${ids(r)})`);
  check(!ids(r).includes('c2'), 'the Fun child is not returned');
  const none = await tool.call({ payeeName: 'Splitter', categoryName: 'Rent', ...range });
  check(none.count === 0, 'a non-matching category returns nothing');
  const unknown = await tool.call({ payeeName: 'Splitter', categoryName: 'Nope', ...range });
  check(unknown.count === 0 && unknown.error === 'Category "Nope" not found', 'an unknown category keeps its error result');
  const plain = await tool.call({ payeeName: 'Splitter', ...range });
  check(ids(plain) === 'f1,f2,sp', `payee alone returns the parent row (${ids(plain)})`);
}

describe('actual_transactions_search_by_month');
{
  const tool = await load('transactions_search_by_month');
  const r = await tool.call({ month: '2019-04', categoryName: 'Fun' });
  check(ids(r) === 'c2', `a month with a category finds the Fun child (${ids(r)})`);
  check(r.totalAmount === -2000, `totalAmount is the child amount (${r.totalAmount})`);
  const none = await tool.call({ month: '2019-04', categoryName: 'Rent' });
  check(none.count === 0, 'a non-matching category returns nothing');
  const unknown = await tool.call({ month: '2019-04', categoryName: 'Nope' });
  check(unknown.count === 0 && unknown.error === 'Category "Nope" not found', 'an unknown category keeps its error result');
  const plain = await tool.call({ month: '2019-04' });
  check(ids(plain) === 'f1,f2,sp', `a month without a category returns the parent row (${ids(plain)})`);
}

describe('actual_transactions_search_by_amount');
{
  const tool = await load('transactions_search_by_amount');
  const r = await tool.call({ absoluteAmount: 2000, categoryName: 'Fun', ...range });
  check(ids(r) === 'c2', `absoluteAmount plus category compares with the child amount (${ids(r)})`);
  const parentAmount = await tool.call({ absoluteAmount: 3000, categoryName: 'Fun', ...range });
  check(parentAmount.count === 0, 'the split total no longer matches once a category is given');
  const none = await tool.call({ absoluteAmount: 2000, categoryName: 'Rent', ...range });
  check(none.count === 0, 'a non-matching category returns nothing');
  const unknown = await tool.call({ absoluteAmount: 2000, categoryName: 'Nope', ...range });
  check(unknown.count === 0 && unknown.error === 'Category "Nope" not found', 'an unknown category keeps its error result');
  const plain = await tool.call({ absoluteAmount: 3000, ...range });
  check(ids(plain) === 'sp', `without a category the split total still matches the parent (${ids(plain)})`);
}

describe('actual_transactions_filter');
{
  const tool = await load('transactions_filter');
  const byCat = await tool.call({ categoryId: FOOD });
  check(ids(byCat) === 'c1,f1,f2', `categoryId finds the child (${ids(byCat)})`);
  check(rowsOf(byCat).find((t) => t.id === 'c1')?.parent_id === 'sp', 'the child carries parent_id');
  const byChildNotes = await tool.call({ notes: 'child' });
  check(ids(byChildNotes) === 'c1', `notes matching only a child's own notes return that child (${ids(byChildNotes)})`);
  const byParentNotes = await tool.call({ notes: 'trip' });
  check(ids(byParentNotes) === 'c1,c2', `notes matching the parent's notes return every child, the whole split (${ids(byParentNotes)})`);
  check(rowsOf(byParentNotes).reduce((n, t) => n + t.amount, 0) === -3000, 'the parent-notes match sums to the split total');
  const none = await tool.call({ categoryId: RENT });
  check(rowsOf(none).length === 0, 'a category with no matching child returns nothing, parent included');
  const plain = await tool.call({ minAmount: -3000, maxAmount: -3000 });
  check(ids(plain) === 'sp' && !('parent_id' in rowsOf(plain)[0]), 'an amount-only filter returns the parent row unchanged');
  const noFilter = await tool.call({});
  check(ids(noFilter) === 'f1,f2,sp', 'no filter returns the parent row unchanged');
}

describe('the helper alone');
{
  const { expandSplitsForSearch, childNotesMatch } = await import('../../dist/src/lib/split-search.js');
  const plain = { id: 'p', account: ACC, date: '2019-01-01', amount: 5, notes: 'x' };
  const { rows, parentNotes } = expandSplitsForSearch([plain, ...grouped().slice(2)]);
  check(rows.some((r) => r.id === 'p' && r === plain), 'a plain row passes through unchanged');
  check(!rows.some((r) => r.id === 'sp') && rows.filter((r) => r.parent_id === 'sp').length === 2, 'a split is replaced by its children');
  check(parentNotes.get('c1') === 'trip' && parentNotes.get('c2') === 'trip', 'parentNotes maps each child to its parent notes');
  const dup = grouped()[2];
  const out = expandSplitsForSearch([dup, { id: 'c1', account: ACC, date: '2019-04-10', amount: -1000, parent_id: 'sp' }]).rows;
  check(out.filter((r) => r.id === 'c1').length === 1, 'a child that is also top-level is not duplicated');
  const c2 = rows.find((r) => r.id === 'c2');
  check(childNotesMatch(c2, parentNotes, 'TRIP') === true, 'an empty-notes child matches its parent notes, case-insensitively');
  const c1 = rows.find((r) => r.id === 'c1');
  check(childNotesMatch(c1, parentNotes, 'trip') === true, 'a child with its own notes also matches the parent notes');
  check(childNotesMatch(c1, parentNotes, 'child') === true && childNotesMatch(c2, parentNotes, 'child') === false, 'a term in one child own notes matches only that child');
}

log(`\n[#750] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
