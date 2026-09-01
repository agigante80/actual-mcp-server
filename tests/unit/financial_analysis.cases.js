import assert from 'node:assert/strict';
import {
  aggregateTransactions,
  postingRows,
  summarizeAccountFlow,
  summarizeRecurringExpenses,
} from '../../dist/src/lib/financial-analysis.js';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error.stack || error}`);
  }
}

const accounts = [
  { id: 'personal', name: 'Personal' },
  { id: 'shared', name: 'Shared' },
  { id: 'savings', name: 'Savings' },
];
const categories = [
  { id: 'groceries', name: 'Groceries', group: 'needs' },
  { id: 'dining', name: 'Dining', group: 'wants' },
  { id: 'salary', name: 'Salary', group: 'income', is_income: true },
];
const categoryGroups = [
  { id: 'needs', name: 'Needs' },
  { id: 'wants', name: 'Wants' },
  { id: 'income', name: 'Income', is_income: true },
];
const payees = [
  { id: 'market', name: 'Supermarket' },
  { id: 'restaurant', name: 'Restaurant' },
  { id: 'employer', name: 'Employer' },
  { id: 'to-shared', name: 'Shared account', transfer_acct: 'shared' },
  { id: 'from-personal', name: 'Personal account', transfer_acct: 'personal' },
  { id: 'netflix', name: 'Netflix' },
  { id: 'apple', name: 'Apple' },
  { id: 'amazon', name: 'Amazon' },
];

function snapshot(transactions, extra = {}) {
  return {
    accounts,
    categories,
    categoryGroups,
    payees,
    transactions,
    transferCounterparts: [],
    ...extra,
  };
}

function aggregate(transactions, overrides = {}) {
  return aggregateTransactions(snapshot(transactions), {
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    groupBy: ['category'],
    includeIncome: false,
    excludeTransfers: true,
    ...overrides,
  });
}

console.log('\n[financial-analysis]');

await check('category totals, refund credits, and exact reconciliation', () => {
  const result = aggregate([
    { id: 'g1', date: '2026-01-02', amount: -10000, account: 'shared', category: 'groceries', payee: 'market' },
    { id: 'd1', date: '2026-01-03', amount: -5000, account: 'shared', category: 'dining', payee: 'restaurant' },
    { id: 'g2', date: '2026-01-04', amount: -2500, account: 'shared', category: 'groceries', payee: 'market' },
    { id: 'r1', date: '2026-01-05', amount: 2500, account: 'shared', category: 'dining', payee: 'restaurant' },
  ]);
  assert.equal(result.totals.expenseOutflow, 17500);
  assert.equal(result.totals.credits, 2500);
  assert.equal(result.totals.netExpense, 15000);
  assert.equal(result.groups.reduce((sum, group) => sum + group.netExpense, 0), result.totals.netExpense);
});

await check('transfer never becomes spending for all or either account', () => {
  const transactions = [
    { id: 'debit', date: '2026-01-31', amount: -100000, account: 'personal', payee: 'to-shared', transfer_id: 'credit' },
    { id: 'credit', date: '2026-02-01', amount: 100000, account: 'shared', payee: 'from-personal', transfer_id: 'debit' },
    { id: 'expense', date: '2026-02-02', amount: -20000, account: 'shared', category: 'groceries', payee: 'market' },
  ];
  assert.equal(aggregate(transactions).totals.expenseOutflow, 20000);
  assert.equal(aggregate(transactions, { accountIds: ['personal'] }).totals.expenseOutflow, 0);
  assert.equal(aggregate(transactions, { accountIds: ['shared'] }).totals.expenseOutflow, 20000);
  assert.equal(aggregate(transactions, { startDate: '2026-01-01', endDate: '2026-01-31' }).totals.expenseOutflow, 0);
  assert.equal(aggregate(transactions, { startDate: '2026-02-01', endDate: '2026-02-28' }).totals.expenseOutflow, 20000);
});

await check('split parent is excluded and children are counted once', () => {
  const parent = {
    id: 'split', date: '2026-03-01', amount: -10000, account: 'shared', payee: 'market', is_parent: true,
    subtransactions: [
      { id: 'split-a', date: '2026-03-01', amount: -6000, account: 'shared', payee: 'market', category: 'groceries', parent_id: 'split', is_child: true },
      { id: 'split-b', date: '2026-03-01', amount: -4000, account: 'shared', payee: 'market', category: 'dining', parent_id: 'split', is_child: true },
    ],
  };
  assert.equal(postingRows([parent]).length, 2);
  const result = aggregate([parent]);
  assert.equal(result.totals.expenseOutflow, 10000);
  assert.deepEqual(result.groups.map(group => group.expenseOutflow).sort((a, b) => a - b), [4000, 6000]);
});

await check('income and uncategorized inflows are never guessed as credits', () => {
  const transactions = [
    { id: 'salary', date: '2026-04-01', amount: 300000, account: 'personal', category: 'salary', payee: 'employer' },
    { id: 'mystery', date: '2026-04-02', amount: 1234, account: 'personal' },
  ];
  const withoutIncome = aggregate(transactions);
  assert.equal(withoutIncome.totals.income, 0);
  assert.equal(withoutIncome.totals.uncategorizedInflows, 1234);
  const withIncome = aggregate(transactions, { includeIncome: true });
  assert.equal(withIncome.totals.income, 300000);
  assert.equal(withIncome.totals.credits, 0);
});

await check('empty aggregate has stable zero totals', () => {
  const result = aggregate([]);
  assert.deepEqual(result.groups, []);
  assert.equal(result.totals.expenseOutflow, 0);
  assert.equal(result.totals.transactionCount, 0);
});

await check('account flow separates transfer funding and external spending', () => {
  const transactions = [
    { id: 'debit', date: '2026-05-01', amount: -100000, account: 'personal', payee: 'to-shared', transfer_id: 'credit' },
    { id: 'credit', date: '2026-05-01', amount: 100000, account: 'shared', payee: 'from-personal', transfer_id: 'debit' },
    { id: 'expense', date: '2026-05-02', amount: -20000, account: 'shared', category: 'groceries', payee: 'market' },
  ];
  const data = snapshot(transactions, {
    openingBalances: { shared: 0 },
    closingBalances: { shared: 80000 },
  });
  const result = summarizeAccountFlow(data, { startDate: '2026-05-01', endDate: '2026-05-31', accountIds: ['shared'] });
  assert.equal(result.transfers.intoSelection, 100000);
  assert.equal(result.external.expenseOutflow, 20000);
  assert.equal(result.balanceChange, 80000);
  assert.equal(result.reconciliation.difference, 0);
  assert.deepEqual(result.transfersByAccount[0].fromAccountName, 'Personal');
});

await check('internal transfer has volume but zero combined effect', () => {
  const transactions = [
    { id: 'debit', date: '2026-06-01', amount: -100000, account: 'personal', payee: 'to-shared', transfer_id: 'credit' },
    { id: 'credit', date: '2026-06-01', amount: 100000, account: 'shared', payee: 'from-personal', transfer_id: 'debit' },
  ];
  const data = snapshot(transactions, {
    openingBalances: { personal: 100000, shared: 0 },
    closingBalances: { personal: 0, shared: 100000 },
  });
  const result = summarizeAccountFlow(data, { startDate: '2026-06-01', endDate: '2026-06-30', accountIds: ['personal', 'shared'] });
  assert.equal(result.transfers.withinSelection, 100000);
  assert.equal(result.transfers.netTransferEffect, 0);
  assert.equal(result.external.expenseOutflow, 0);
  assert.equal(result.reconciliation.difference, 0);
});

await check('starting balance inside range is an explicit adjustment', () => {
  const data = snapshot([
    { id: 'opening', date: '2026-07-01', amount: 50000, account: 'personal', starting_balance_flag: true },
  ], { openingBalances: { personal: 0 }, closingBalances: { personal: 50000 } });
  const result = summarizeAccountFlow(data, { startDate: '2026-07-01', endDate: '2026-07-31', accountIds: ['personal'] });
  assert.equal(result.adjustments.startingBalance, 50000);
  assert.equal(result.external.income, 0);
  assert.equal(result.reconciliation.difference, 0);
});

function recurringTransactions(payee, amount, dates, account = 'personal') {
  return dates.map((date, index) => ({
    id: `${payee}-${amount}-${index}`,
    date,
    amount: -amount,
    account,
    payee,
    category: 'dining',
  }));
}

function recurring(transactions, overrides = {}) {
  return summarizeRecurringExpenses(snapshot(transactions), {
    startDate: '2024-01-01',
    endDate: '2026-12-31',
    minOccurrences: 3,
    includeInactive: true,
    ...overrides,
  });
}

await check('month-end subscription is monthly and annualized from current cost', () => {
  const result = recurring(recurringTransactions('netflix', 1599, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']), {
    endDate: '2026-04-30', includeInactive: false,
  });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].frequency, 'monthly');
  assert.equal(result.series[0].latestAmount, 1599);
  assert.equal(result.series[0].annualizedAmount, 19188);
  assert.equal(result.series[0].confidence, 'high');
  assert.equal(result.totalAnnualizedRecurringExpenses, 19188);
});

await check('price increase merges contiguous amount lanes and reports exact change', () => {
  const oldDates = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'];
  const newDates = ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05', '2026-12-05'];
  const result = recurring([
    ...recurringTransactions('netflix', 1599, oldDates),
    ...recurringTransactions('netflix', 1799, newDates),
  ], { endDate: '2026-12-05' });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].latestAmount, 1799);
  assert.equal(result.series[0].previousAmount, 1599);
  assert.equal(result.series[0].priceChange.absoluteChange, 200);
  assert.equal(result.series[0].annualizedAmount, 21588);
});

await check('small price increase is not hidden by recurrence matching tolerance', () => {
  const oldDates = ['2026-01-05', '2026-02-05', '2026-03-05'];
  const newDates = ['2026-04-05', '2026-05-05', '2026-06-05'];
  const result = recurring([
    ...recurringTransactions('netflix', 1599, oldDates),
    ...recurringTransactions('netflix', 1649, newDates),
  ], { endDate: '2026-06-05' });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].latestAmount, 1649);
  assert.equal(result.series[0].previousAmount, 1599);
  assert.equal(result.series[0].priceChange.absoluteChange, 50);
  assert.equal(result.series[0].annualizedAmount, 19788);
});

await check('two recurring charges from one payee remain separate', () => {
  const dates = ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10'];
  const result = recurring([
    ...recurringTransactions('apple', 999, dates),
    ...recurringTransactions('apple', 299, dates),
  ], { endDate: '2026-04-10' });
  assert.deepEqual(result.series.map(item => item.latestAmount).sort((a, b) => a - b), [299, 999]);
});

await check('irregular merchant is not labeled recurring', () => {
  const result = recurring(recurringTransactions('amazon', 1000, ['2026-01-01', '2026-01-03', '2026-01-19', '2026-02-22', '2026-05-01']), {
    endDate: '2026-05-01',
  });
  assert.equal(result.series.length, 0);
});

await check('transfer is excluded from recurring expenses', () => {
  const rows = ['2026-01-01', '2026-02-01', '2026-03-01'].map((date, index) => ({
    id: `xfer-${index}`, date, amount: -50000, account: 'personal', payee: 'to-shared', transfer_id: `other-${index}`,
  }));
  assert.equal(recurring(rows, { endDate: '2026-03-01' }).series.length, 0);
});

await check('cancelled series is omitted unless inactive results are requested', () => {
  const rows = recurringTransactions('netflix', 1599, ['2026-01-05', '2026-02-05', '2026-03-05']);
  assert.equal(recurring(rows, { endDate: '2026-06-30', includeInactive: false }).series.length, 0);
  const included = recurring(rows, { endDate: '2026-06-30', includeInactive: true });
  assert.equal(included.series[0].active, false);
  assert.equal(included.totalAnnualizedRecurringExpenses, 0);
});

await check('two yearly observations are sufficient with medium confidence', () => {
  const result = recurring(recurringTransactions('netflix', 10000, ['2024-08-15', '2025-08-15']), {
    startDate: '2024-01-01', endDate: '2025-12-31', includeInactive: false,
  });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].frequency, 'yearly');
  assert.equal(result.series[0].annualizedAmount, 10000);
});

await check('recurring split counts one payment event per parent', () => {
  const rows = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, index) => ({
    id: `parent-${index}`, date, amount: -10000, account: 'personal', payee: 'netflix', is_parent: true,
    subtransactions: [
      { id: `child-a-${index}`, date, amount: -6000, account: 'personal', payee: 'netflix', category: 'groceries', parent_id: `parent-${index}`, is_child: true },
      { id: `child-b-${index}`, date, amount: -4000, account: 'personal', payee: 'netflix', category: 'dining', parent_id: `parent-${index}`, is_child: true },
    ],
  }));
  const result = recurring(rows, { endDate: '2026-03-15', includeInactive: false });
  assert.equal(result.series[0].occurrenceCount, 3);
  assert.equal(result.series[0].latestAmount, 10000);
});

console.log(`\n[financial-analysis] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
