// tests/unit/recurring_expenses_summary.test.js
//
// #426: actual_recurring_expenses_summary. The widest scenario set of the three deterministic tools,
// because it is the only HEURISTIC one. Covers cadence detection with date drift and month-end clamp,
// exact-median established amount (a small increase is not hidden), price-change lane merge, distinct
// lanes kept separate, the two-miss inactive rule, transfer exclusion, minOccurrences, split single
// count, and the #388 name refusal on the tool surface.
//
// Heuristic ported verbatim from @maxvanweenen (PR #399); fixtures mirror that PR's cases.
//
// Run: node tests/unit/recurring_expenses_summary.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const { summarizeRecurringExpenses } = await import('../../dist/src/lib/financial-analysis.js');
const recurringTool = (await import('../../dist/src/tools/recurring_expenses_summary.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;

let passed = 0, failed = 0;
function check(label, fn) { try { fn(); console.log(`  ok: ${label}`); passed++; } catch (e) { console.error(`  FAIL: ${label} -> ${e.message}`); failed++; } }
async function acheck(label, fn) { try { await fn(); console.log(`  ok: ${label}`); passed++; } catch (e) { console.error(`  FAIL: ${label} -> ${e.message}`); failed++; } }

const accounts = [{ id: 'personal', name: 'Personal' }, { id: 'shared', name: 'Shared' }];
const categories = [{ id: 'dining', name: 'Dining', group: 'wants' }];
const categoryGroups = [{ id: 'wants', name: 'Wants' }];
const payees = [
  { id: 'netflix', name: 'Netflix' },
  { id: 'apple', name: 'Apple' },
  { id: 'amazon', name: 'Amazon' },
];

function snapshot(transactions, extra = {}) {
  return { accounts, categories, categoryGroups, payees, transactions, transferCounterparts: [], ...extra };
}
function charges(payee, amount, dates, account = 'personal') {
  return dates.map((date, index) => ({ id: `${payee}-${amount}-${index}`, date, amount: -amount, account, payee, category: 'dining' }));
}
function recurring(transactions, overrides = {}) {
  return summarizeRecurringExpenses(snapshot(transactions), {
    startDate: '2024-01-01', endDate: '2026-12-31', minOccurrences: 3, includeInactive: true, ...overrides,
  });
}

console.log('\n[recurring] cadence + amount heuristics (pure)');

check('date drift is tolerated: 3rd, 5th, 2nd of consecutive months is ONE monthly series', () => {
  const r = recurring(charges('netflix', 1599, ['2026-01-03', '2026-02-05', '2026-03-02']), { endDate: '2026-03-31' });
  assert.strictEqual(r.series.length, 1);
  assert.strictEqual(r.series[0].frequency, 'monthly');
  assert.strictEqual(r.series[0].latestAmount, 1599);
});

check('month-end clamp: Jan31/Feb28/Mar31/Apr30 is monthly, annualized from current cost', () => {
  const r = recurring(charges('netflix', 1599, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']), { endDate: '2026-04-30', includeInactive: false });
  assert.strictEqual(r.series.length, 1);
  assert.strictEqual(r.series[0].frequency, 'monthly');
  assert.strictEqual(r.series[0].latestAmount, 1599);
  assert.strictEqual(r.series[0].annualizedAmount, 19188); // 1599 * 12
  assert.strictEqual(r.series[0].confidence, 'high');
  assert.strictEqual(r.totalAnnualizedRecurringExpenses, 19188);
});

check('price change (large) merges contiguous lanes into ONE series with the exact new amount', () => {
  const oldD = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'];
  const newD = ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05', '2026-12-05'];
  const r = recurring([...charges('netflix', 1599, oldD), ...charges('netflix', 1799, newD)], { endDate: '2026-12-05' });
  assert.strictEqual(r.series.length, 1);
  assert.strictEqual(r.series[0].latestAmount, 1799);
  assert.strictEqual(r.series[0].previousAmount, 1599);
  assert.strictEqual(r.series[0].priceChange.absoluteChange, 200);
  assert.strictEqual(r.series[0].annualizedAmount, 21588); // 1799 * 12
});

check('a SMALL price increase is not hidden by the matching tolerance (exact median)', () => {
  const oldD = ['2026-01-05', '2026-02-05', '2026-03-05'];
  const newD = ['2026-04-05', '2026-05-05', '2026-06-05'];
  const r = recurring([...charges('netflix', 1599, oldD), ...charges('netflix', 1649, newD)], { endDate: '2026-06-05' });
  assert.strictEqual(r.series.length, 1);
  assert.strictEqual(r.series[0].latestAmount, 1649);
  assert.strictEqual(r.series[0].previousAmount, 1599);
  assert.strictEqual(r.series[0].priceChange.absoluteChange, 50);
  assert.strictEqual(r.series[0].annualizedAmount, 19788); // 1649 * 12
});

check('two genuinely distinct amounts from one payee stay TWO series, not one averaged', () => {
  const dates = ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10'];
  const r = recurring([...charges('apple', 999, dates), ...charges('apple', 299, dates)], { endDate: '2026-04-10' });
  assert.deepStrictEqual(r.series.map(s => s.latestAmount).sort((a, b) => a - b), [299, 999]);
});

check('active vs inactive: a stopped series obeys the two-miss rule and includeInactive', () => {
  const rows = charges('netflix', 1599, ['2026-01-05', '2026-02-05', '2026-03-05']);
  assert.strictEqual(recurring(rows, { endDate: '2026-06-30', includeInactive: false }).series.length, 0);
  const included = recurring(rows, { endDate: '2026-06-30', includeInactive: true });
  assert.strictEqual(included.series[0].active, false);
  assert.strictEqual(included.totalAnnualizedRecurringExpenses, 0); // inactive excluded from the total
});

check('two yearly observations are sufficient (relaxed minOccurrences floor)', () => {
  const r = recurring(charges('netflix', 10000, ['2024-08-15', '2025-08-15']), { startDate: '2024-01-01', endDate: '2025-12-31', includeInactive: false });
  assert.strictEqual(r.series.length, 1);
  assert.strictEqual(r.series[0].frequency, 'yearly');
  assert.strictEqual(r.series[0].annualizedAmount, 10000);
});

check('a recurring SPLIT parent counts one payment event per parent, children summed once', () => {
  const rows = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) => ({
    id: `parent-${i}`, date, amount: -10000, account: 'personal', payee: 'netflix', is_parent: true,
    subtransactions: [
      { id: `child-a-${i}`, date, amount: -6000, account: 'personal', payee: 'netflix', category: 'dining', parent_id: `parent-${i}`, is_child: true },
      { id: `child-b-${i}`, date, amount: -4000, account: 'personal', payee: 'netflix', category: 'dining', parent_id: `parent-${i}`, is_child: true },
    ],
  }));
  const r = recurring(rows, { endDate: '2026-03-15', includeInactive: false });
  assert.strictEqual(r.series[0].occurrenceCount, 3);
  assert.strictEqual(r.series[0].latestAmount, 10000);
});

console.log('\n[recurring] negatives (pure)');

check('a TRANSFER is never counted as recurring', () => {
  const rows = ['2026-01-01', '2026-02-01', '2026-03-01'].map((date, i) => ({
    id: `xfer-${i}`, date, amount: -50000, account: 'personal', payee: 'netflix', transfer_id: `other-${i}`,
  }));
  assert.strictEqual(recurring(rows, { endDate: '2026-03-01' }).series.length, 0);
});

check('below minOccurrences is NOT reported as recurring', () => {
  const r = recurring(charges('netflix', 1599, ['2026-01-05', '2026-02-05']), { endDate: '2026-02-05', minOccurrences: 3 });
  assert.strictEqual(r.series.length, 0);
});

check('an irregular merchant is not labeled recurring', () => {
  const r = recurring(charges('amazon', 1000, ['2026-01-01', '2026-01-03', '2026-01-19', '2026-02-22', '2026-05-01']), { endDate: '2026-05-01' });
  assert.strictEqual(r.series.length, 0);
});

console.log('\n[recurring] tool surface (#388 resolveFilterId + validation)');

// resolveFilterId's verifyExists path matches by real UUID, so the tool tests use one.
const ACC1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const originalSnapshot = adapter.getFinancialAnalysisSnapshot;
adapter.getFinancialAnalysisSnapshot = async () => ({
  transactions: charges('netflix', 1599, ['2026-01-05', '2026-02-05', '2026-03-05'], ACC1),
  transferCounterparts: [], accounts: [{ id: ACC1, name: 'Checking' }],
  categories, categoryGroups, payees,
});

await acheck('POSITIVE: the tool detects a monthly series end to end', async () => {
  const res = await recurringTool.call({ startDate: '2026-01-01', endDate: '2026-03-31', minOccurrences: 3, includeInactive: false });
  const r = res.result ?? res;
  assert.strictEqual(r.series.length, 1, 'one series detected');
  assert.strictEqual(r.series[0].frequency, 'monthly');
  assert.strictEqual(r.series[0].latestAmount, 1599);
});

await acheck('NEGATIVE: an account NAME is refused with the resolved id (#388)', async () => {
  let thrown = null;
  try { await recurringTool.call({ startDate: '2026-01-01', endDate: '2026-03-31', accountIds: ['Checking'] }); }
  catch (e) { thrown = e; }
  assert.ok(thrown && thrown.message.includes(ACC1), `name resolves to its id (got: ${thrown && thrown.message})`);
});

await acheck('NEGATIVE: startDate AND months together is rejected, error names months', async () => {
  let thrown = null;
  try { await recurringTool.call({ startDate: '2026-01-01', months: 12 }); }
  catch (e) { thrown = e; }
  assert.ok(thrown && /months/.test(thrown.message), `error names months (got: ${thrown && thrown.message})`);
});

await acheck('NEGATIVE: endDate before startDate is rejected, error names endDate', async () => {
  let thrown = null;
  try { await recurringTool.call({ startDate: '2026-02-01', endDate: '2026-01-01' }); }
  catch (e) { thrown = e; }
  assert.ok(thrown && /endDate/.test(thrown.message), `error names endDate (got: ${thrown && thrown.message})`);
});

await acheck('months lookback computes a clean one-month window across a month-end boundary', async () => {
  // endDate on the 31st, months:1 must clamp to the 1st of the same month (a whole month back),
  // not overflow into the previous month. The tool echoes the computed range in dateRange.
  const res = await recurringTool.call({ endDate: '2026-03-31', months: 1 });
  const r = res.result ?? res;
  assert.strictEqual(r.dateRange.startDate, '2026-03-01', `startFromMonths clamps the boundary (got ${r.dateRange.startDate})`);
  assert.strictEqual(r.dateRange.endDate, '2026-03-31');
});

adapter.getFinancialAnalysisSnapshot = originalSnapshot;

console.log(`\n[recurring] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
