// tests/unit/search_duplicate_names.test.js
// #802: the name-keyed transaction searches match EVERY category or payee carrying the name
// (the same category name can sit in two groups, a payee name can repeat), not only the first row
// of the listing. An unknown name keeps its exact not-found result. Stubbed adapter, real tools.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const CAT1 = 'cat-fun-1', CAT2 = 'cat-fun-2', CAT3 = 'cat-solo', CAT4 = 'cat-solo2';
const PAY1 = 'pay-dup-1', PAY2 = 'pay-dup-2', PAY3 = 'pay-other';
const ACC = 'acc-1';

const tx = (id, category, payee, amount = -100) => ({ id, account: ACC, date: '2026-03-10', category, payee, amount });
const TXNS = [
  tx('t1', CAT1, PAY1, -100),
  tx('t2', CAT2, PAY2, -200),
  tx('t3', CAT3, PAY3, -300),
  tx('t4', CAT4, PAY3, -400),
  tx('t5', CAT1, PAY3, -100),
  tx('t6', CAT2, PAY3, -100),
];

(async () => {
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  adapter.getAccounts = async () => [{ id: ACC, name: 'Checking', offbudget: false }];
  adapter.getCategories = async () => [
    { id: CAT1, name: 'Fun' }, { id: CAT2, name: 'Fun' }, { id: CAT3, name: 'Solo' }, { id: CAT4, name: 'Solo2' },
    { id: 'cat-null', name: null }, { name: 'Fun' },
  ];
  adapter.getPayees = async () => [
    { id: PAY1, name: 'Dup' }, { id: PAY2, name: 'Dup', transfer_acct: 'acc-9' }, { id: PAY3, name: 'Other' },
    { id: 'pay-blank', name: '' },
  ];
  adapter.getTransactions = async () => TXNS.map((t) => ({ ...t }));

  const byCategory = (await import('../../dist/src/tools/transactions_search_by_category.js')).default;
  const byMonth = (await import('../../dist/src/tools/transactions_search_by_month.js')).default;
  const byPayee = (await import('../../dist/src/tools/transactions_search_by_payee.js')).default;
  const byAmount = (await import('../../dist/src/tools/transactions_search_by_amount.js')).default;

  const ids = (r) => (r.transactions ?? []).map((t) => t.id).sort().join(',');
  const sum = (r) => (r.transactions ?? []).reduce((a, t) => a + t.amount, 0);

  console.log('\n[#802] a duplicated category name returns every category\'s rows');
  {
    const r = await byCategory.call({ categoryName: 'Fun' });
    check(ids(r) === 't1,t2,t5,t6', 'by_category: both Fun categories', ids(r));
    check(r.count === 4 && r.totalAmount === -500 && sum(r) === r.totalAmount, 'by_category: count and totalAmount cover the rows shown');
    const t = await byCategory.call({ categoryName: '  fUN  ' });
    check(ids(t) === 't1,t2,t5,t6', 'by_category: trimmed and case-insensitive', ids(t));
    const m = await byMonth.call({ month: '2026-03', categoryName: 'Fun' });
    check(ids(m) === 't1,t2,t5,t6', 'by_month category: both', ids(m));
    const p = await byPayee.call({ payeeName: 'Other', categoryName: 'Fun' });
    check(ids(p) === 't5,t6', 'by_payee category narrowing: both', ids(p));
    const a = await byAmount.call({ startDate: '2026-03-01', absoluteAmount: 100, categoryName: 'Fun' });
    check(ids(a) === 't1,t5,t6', 'by_amount category: both', ids(a));
  }

  console.log('\n[#802] a duplicated payee name returns every payee\'s rows (a transfer payee included)');
  {
    const r = await byPayee.call({ payeeName: 'Dup' });
    check(ids(r) === 't1,t2', 'by_payee: both Dup payees', ids(r));
    const m = await byMonth.call({ month: '2026-03', payeeName: 'dup' });
    check(ids(m) === 't1,t2', 'by_month payee: both', ids(m));
    const n = await byPayee.call({ payeeName: 'Dup', categoryName: 'Fun' });
    check(ids(n) === 't1,t2', 'by_payee with a category: both payees, both categories', ids(n));
  }

  console.log('\n[#802] unknown and blank names keep the existing not-found result (#755: plus hasMore false)');
  {
    const c = await byCategory.call({ categoryName: 'Nope' });
    check(JSON.stringify(c) === JSON.stringify({ transactions: [], count: 0, totalAmount: 0, hasMore: false, categoryName: 'Nope', error: 'Category "Nope" not found' }), 'by_category unknown', JSON.stringify(c));
    const p = await byPayee.call({ payeeName: 'Nobody' });
    check(JSON.stringify(p) === JSON.stringify({ transactions: [], count: 0, totalAmount: 0, hasMore: false, payeeName: 'Nobody', error: 'Payee "Nobody" not found' }), 'by_payee unknown', JSON.stringify(p));
    const m = await byMonth.call({ month: '2026-03', categoryName: 'Nope' });
    check(m.count === 0 && m.error === 'Category "Nope" not found', 'by_month unknown category');
    const mp = await byMonth.call({ month: '2026-03', payeeName: 'Nobody' });
    check(mp.count === 0 && mp.error === 'Payee "Nobody" not found', 'by_month unknown payee');
    const pc = await byPayee.call({ payeeName: 'Other', categoryName: 'Nope' });
    check(pc.count === 0 && pc.error === 'Category "Nope" not found', 'by_payee unknown category');
    const a = await byAmount.call({ startDate: '2026-03-01', absoluteAmount: 100, categoryName: 'Nope' });
    check(a.count === 0 && a.error === 'Category "Nope" not found', 'by_amount unknown category');
    const blank = await byCategory.call({ categoryName: '   ' });
    check(blank.count === 0 && blank.error === 'Category "   " not found', 'a blank name matches nothing, not every category', JSON.stringify(blank));
    const nullName = await byCategory.call({ categoryName: 'null' });
    check(nullName.count === 0, 'a row with a null name is never matched');
  }

  console.log('\n[#802] a single match and an unfiltered search are unchanged');
  {
    const r = await byCategory.call({ categoryName: 'Solo' });
    check(ids(r) === 't3', 'Solo matches only Solo, not Solo2', ids(r));
    const all = await byCategory.call({});
    check(all.count === TXNS.length, 'no name: every row, untouched', String(all.count));
  }

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll #802 checks passed');
})();
