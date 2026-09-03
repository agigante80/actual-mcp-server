// tests/unit/transactions_aggregate.test.js
//
// #424: actual_transactions_aggregate. Covers the deterministic accounting (transfer-first
// exclusion, split single-count, integer cents, group-sum reconciliation) against fixed cent rows,
// AND the tool surface: the #388 resolveFilterId path refuses a NAME with the resolved id.
//
// Original implementation by @maxvanweenen (PR #399), requested in #398.
//
// Run: node tests/unit/transactions_aggregate.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const { aggregateTransactions } = await import('../../dist/src/lib/financial-analysis.js');
const aggregateTool = (await import('../../dist/src/tools/transactions_aggregate.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
async function acheck(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// ---- Fixture snapshot (all amounts in integer cents) --------------------------------------------
const accounts = [{ id: 'acc-1', name: 'Checking' }, { id: 'acc-2', name: 'Savings' }];
const categories = [
  { id: 'cat-inc', name: 'Salary', is_income: true, group: 'grp-1' },
  { id: 'cat-food', name: 'Groceries', is_income: false, group: 'grp-1' },
];
const categoryGroups = [{ id: 'grp-1', name: 'Expenses' }];
const payees = [{ id: 'pay-1', name: 'Employer' }];

function baseSnapshot(transactions) {
  return { transactions, accounts, categories, categoryGroups, payees };
}

const dateRange = { startDate: '2025-01-01', endDate: '2025-03-31' };

console.log('\n[transactions-aggregate] accounting (pure)');

check('a CATEGORIZED transfer (income category) is excluded even with includeIncome=true', () => {
  const snapshot = baseSnapshot([
    { id: 't-pay', date: '2025-01-05', amount: 500000, account: 'acc-1', category: 'cat-inc', payee: 'pay-1' },
    // A transfer categorized WITH an income category. transfer_id must win.
    { id: 't-xfer', date: '2025-01-10', amount: 100000, account: 'acc-1', category: 'cat-inc', transfer_id: 'x1' },
  ]);
  const r = aggregateTransactions(snapshot, { ...dateRange, groupBy: ['month'], includeIncome: true, excludeTransfers: true });
  assert.strictEqual(r.totals.income, 500000, 'income is only the paycheck, not the transfer');
  assert.strictEqual(r.totals.transferInflow, 0, 'the excluded transfer contributes no inflow');
  assert.strictEqual(r.totals.transferCount, 0, 'the excluded transfer is not counted');
});

check('a split parent is excluded and its children are summed exactly once', () => {
  const snapshot = baseSnapshot([
    {
      id: 't-split', date: '2025-02-01', amount: -10000, account: 'acc-1', is_parent: true,
      subtransactions: [
        { id: 't-c1', date: '2025-02-01', amount: -6000, account: 'acc-1', category: 'cat-food' },
        { id: 't-c2', date: '2025-02-01', amount: -4000, account: 'acc-1', category: 'cat-food' },
      ],
    },
  ]);
  const r = aggregateTransactions(snapshot, { ...dateRange, groupBy: ['month'], includeIncome: false, excludeTransfers: true });
  assert.strictEqual(r.totals.expenseOutflow, 10000, 'children summed to 10000, parent contributes nothing');
  assert.strictEqual(r.totals.transactionCount, 2, 'the two children count, the parent does not');
});

check('excludeTransfers=false reports transfers in their own fields, never as spending', () => {
  const snapshot = baseSnapshot([
    { id: 't-food', date: '2025-01-03', amount: -5000, account: 'acc-1', category: 'cat-food' },
    { id: 't-xin', date: '2025-01-04', amount: 20000, account: 'acc-1', transfer_id: 'x2' },
    { id: 't-xout', date: '2025-01-05', amount: -8000, account: 'acc-1', transfer_id: 'x3' },
  ]);
  const r = aggregateTransactions(snapshot, { ...dateRange, groupBy: ['month'], includeIncome: false, excludeTransfers: false });
  assert.strictEqual(r.totals.expenseOutflow, 5000, 'only the real expense is spending');
  assert.strictEqual(r.totals.transferInflow, 20000, 'transfer in reported separately');
  assert.strictEqual(r.totals.transferOutflow, 8000, 'transfer out reported separately');
});

check('groupBy month: the sum of per-group totals equals the ungrouped total', () => {
  const txns = [
    { id: 'a', date: '2025-01-10', amount: -1000, account: 'acc-1', category: 'cat-food' },
    { id: 'b', date: '2025-02-10', amount: -2000, account: 'acc-1', category: 'cat-food' },
    { id: 'c', date: '2025-03-10', amount: -3000, account: 'acc-1', category: 'cat-food' },
  ];
  const grouped = aggregateTransactions(baseSnapshot(txns), { ...dateRange, groupBy: ['month'], includeIncome: false, excludeTransfers: true });
  const ungrouped = aggregateTransactions(baseSnapshot(txns), { ...dateRange, groupBy: [], includeIncome: false, excludeTransfers: true });
  const sumOfGroups = grouped.groups.reduce((acc, g) => acc + g.expenseOutflow, 0);
  assert.strictEqual(grouped.groups.length, 3, 'three months');
  assert.strictEqual(sumOfGroups, ungrouped.totals.expenseOutflow, 'group sum equals ungrouped total');
  assert.strictEqual(sumOfGroups, 6000);
});

check('multi-dimension groupBy [month, category] keys each group distinctly', () => {
  const txns = [
    { id: 'a', date: '2025-01-10', amount: -1000, account: 'acc-1', category: 'cat-food' },
    { id: 'b', date: '2025-01-11', amount: 500, account: 'acc-1', category: 'cat-inc' },
  ];
  const r = aggregateTransactions(baseSnapshot(txns), { ...dateRange, groupBy: ['month', 'category'], includeIncome: true, excludeTransfers: true });
  assert.strictEqual(r.groups.length, 2, 'food expense and salary income are distinct groups');
});

console.log('\n[transactions-aggregate] tool surface (#388 resolveFilterId + validation)');

// Stub the adapter read so the tool runs offline; resolveFilterId then resolves against the
// snapshot rows we return (it needs no session when given rows).
const originalSnapshot = adapter.getFinancialAnalysisSnapshot;
adapter.getFinancialAnalysisSnapshot = async () => baseSnapshot([
  { id: 't-pay', date: '2025-01-05', amount: 500000, account: 'acc-1', category: 'cat-inc', payee: 'pay-1' },
  { id: 't-xfer', date: '2025-01-10', amount: 100000, account: 'acc-1', category: 'cat-inc', transfer_id: 'x1' },
  { id: 't-food', date: '2025-01-03', amount: -5000, account: 'acc-1', category: 'cat-food' },
]);

await acheck('POSITIVE: the tool excludes the categorized transfer end to end', async () => {
  const res = await aggregateTool.call({ startDate: '2025-01-01', endDate: '2025-01-31', groupBy: 'month', includeIncome: true });
  const result = res.result ?? res;
  assert.strictEqual(result.totals.income, 500000, 'transfer excluded from income through the tool');
  assert.strictEqual(result.totals.expenseOutflow, 5000, 'only the real expense is spending');
});

await acheck('NEGATIVE: a categoryIds NAME is refused with the resolved id (#388)', async () => {
  let thrown = null;
  try {
    await aggregateTool.call({ startDate: '2025-01-01', endDate: '2025-01-31', groupBy: 'category', categoryIds: ['Groceries'] });
  } catch (e) { thrown = e; }
  assert.ok(thrown, 'a name filter is refused, not silently ignored');
  assert.ok(/cat-food/.test(thrown.message), `the refusal names the resolved id (got: ${thrown && thrown.message})`);
  assert.ok(/NAME/i.test(thrown.message), 'the refusal explains it was a name');
});

await acheck('NEGATIVE: a category_group NAME is refused with the resolved id (#424 extension)', async () => {
  let thrown = null;
  try {
    await aggregateTool.call({ startDate: '2025-01-01', endDate: '2025-01-31', groupBy: 'category_group', categoryGroupIds: ['Expenses'] });
  } catch (e) { thrown = e; }
  assert.ok(thrown && /grp-1/.test(thrown.message), `category_group name resolves to its id (got: ${thrown && thrown.message})`);
});

await acheck('NEGATIVE: endDate before startDate is rejected', async () => {
  let thrown = null;
  try {
    await aggregateTool.call({ startDate: '2025-02-01', endDate: '2025-01-01', groupBy: 'month' });
  } catch (e) { thrown = e; }
  assert.ok(thrown && /endDate/.test(thrown.message), 'the validation error names endDate');
});

adapter.getFinancialAnalysisSnapshot = originalSnapshot;

console.log(`\n[transactions-aggregate] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
