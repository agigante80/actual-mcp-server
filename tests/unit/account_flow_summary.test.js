// tests/unit/account_flow_summary.test.js
//
// #425: actual_account_flow_summary. Covers exact reconciliation (opening + net = closing),
// transfer separation (within-selection nets to zero, to-external is transfer-out not expense),
// split single-count, and the #388 name-refusal on the tool surface.
//
// Original implementation by @maxvanweenen (PR #399).
//
// Run: node tests/unit/account_flow_summary.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const { summarizeAccountFlow } = await import('../../dist/src/lib/financial-analysis.js');
const flowTool = (await import('../../dist/src/tools/account_flow_summary.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;

let passed = 0, failed = 0;
function check(label, fn) { try { fn(); console.log(`  ok: ${label}`); passed++; } catch (e) { console.error(`  FAIL: ${label} -> ${e.message}`); failed++; } }
async function acheck(label, fn) { try { await fn(); console.log(`  ok: ${label}`); passed++; } catch (e) { console.error(`  FAIL: ${label} -> ${e.message}`); failed++; } }

const accounts = [{ id: 'acc-1', name: 'Checking' }, { id: 'acc-2', name: 'Savings' }, { id: 'acc-ext', name: 'External' }];
const categories = [{ id: 'cat-inc', name: 'Salary', is_income: true, group: 'g' }, { id: 'cat-food', name: 'Groceries', group: 'g' }];
const range = { startDate: '2025-01-01', endDate: '2025-01-31' };

console.log('\n[account-flow] reconciliation (pure)');

check('#428 Finding 1: unpopulated balances read as NOT reconciled (balancesAvailable false, difference null)', () => {
  // No openingBalances / closingBalances keys at all. Before #428 both reduced to 0 and difference
  // read as a false exact 5000; now it must be null and flagged, while external accounting still runs.
  const snapshot = {
    transactions: [{ id: 'e1', date: '2025-01-05', amount: -5000, account: 'acc-1', category: 'cat-food' }],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1'] });
  assert.strictEqual(r.reconciliation.balancesAvailable, false, 'flagged unavailable');
  assert.strictEqual(r.reconciliation.difference, null, 'difference is null, not a false 0 or 5000');
  assert.strictEqual(r.balanceChange, null, 'balanceChange is null when balances are absent');
  assert.strictEqual(r.external.expenseOutflow, 5000, 'external accounting still computes');
});

check('#428 Finding 1: the tool path (both maps supplied) stays exact and flagged available', () => {
  const snapshot = {
    transactions: [{ id: 'e1', date: '2025-01-05', amount: -5000, account: 'acc-1', category: 'cat-food' }],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 10000 }, closingBalances: { 'acc-1': 5000 },
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1'] });
  assert.strictEqual(r.reconciliation.balancesAvailable, true);
  assert.strictEqual(r.reconciliation.difference, 0, 'exact-by-construction preserved on the tool path');
});

check('#428 Finding 2: an unresolvable counterpart buckets by sign and reports matchedCounterpart false', () => {
  // Transfer leg out of acc-1 whose counterpart row (x2) is absent and whose payee carries no
  // transfer_acct. Deterministic: bucketed by sign (outOfSelection), surfaced via matchedCounterpart
  // false, and reconciliation stays exact because netTransferEffect already counted the amount.
  const snapshot = {
    transactions: [{ id: 'x1', date: '2025-01-10', amount: -3000, account: 'acc-1', transfer_id: 'x2' }],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 5000 }, closingBalances: { 'acc-1': 2000 },
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1', 'acc-2'] });
  assert.strictEqual(r.transfers.outOfSelection, 3000, 'bucketed by sign into outOfSelection');
  assert.strictEqual(r.transfers.withinSelection, 0, 'not claimed as within-selection without proof');
  assert.strictEqual(r.transfersByAccount[0].matchedCounterpart, false, 'unresolved counterpart is observable');
  assert.strictEqual(r.reconciliation.difference, 0, 'reconciliation stays exact');
});

check('external-only: opening + net === closing, difference is 0', () => {
  const snapshot = {
    transactions: [
      { id: 'e1', date: '2025-01-05', amount: -5000, account: 'acc-1', category: 'cat-food' },
      { id: 'i1', date: '2025-01-06', amount: 3000, account: 'acc-1', category: 'cat-inc' },
    ],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 10000 }, closingBalances: { 'acc-1': 8000 },
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1'] });
  assert.strictEqual(r.openingBalance, 10000);
  assert.strictEqual(r.closingBalance, 8000);
  assert.strictEqual(r.external.netExternalCashFlow, -2000, 'income 3000 minus expense 5000');
  assert.strictEqual(r.reconciliation.difference, 0, 'reconciles exactly');
});

check('a WITHIN-selection transfer nets to zero and is never spending', () => {
  const snapshot = {
    transactions: [
      { id: 'x1', date: '2025-01-10', amount: -3000, account: 'acc-1', transfer_id: 'x2' },
      { id: 'x2', date: '2025-01-10', amount: 3000, account: 'acc-2', transfer_id: 'x1' },
    ],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 5000, 'acc-2': 1000 }, closingBalances: { 'acc-1': 2000, 'acc-2': 4000 },
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1', 'acc-2'] });
  assert.strictEqual(r.external.expenseOutflow, 0, 'the transfer is not an expense');
  assert.strictEqual(r.external.netExternalCashFlow, 0, 'no external flow');
  assert.strictEqual(r.transfers.netTransferEffect, 0, 'within-selection legs cancel');
  assert.strictEqual(r.transfers.withinSelection, 3000, 'reported as a within-selection transfer');
  assert.strictEqual(r.reconciliation.difference, 0, 'still reconciles');
});

check('a TO-EXTERNAL transfer is transfer-out, not expense', () => {
  const snapshot = {
    transactions: [{ id: 'xo', date: '2025-01-12', amount: -2000, account: 'acc-1', transfer_id: 'xo-cp' }],
    transferCounterparts: [{ id: 'xo-cp', date: '2025-01-12', amount: 2000, account: 'acc-ext', transfer_id: 'xo' }],
    accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 5000 }, closingBalances: { 'acc-1': 3000 },
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1'] });
  assert.strictEqual(r.external.expenseOutflow, 0, 'a transfer out is not an expense');
  assert.strictEqual(r.transfers.outOfSelection, 2000, 'reported as transfer out');
  assert.strictEqual(r.reconciliation.difference, 0, 'reconciles');
});

check('split children are counted once and the total still reconciles', () => {
  const snapshot = {
    transactions: [
      {
        id: 'sp', date: '2025-01-08', amount: -3000, account: 'acc-1', is_parent: true,
        subtransactions: [
          { id: 'sc1', date: '2025-01-08', amount: -2000, account: 'acc-1', category: 'cat-food' },
          { id: 'sc2', date: '2025-01-08', amount: -1000, account: 'acc-1', category: 'cat-food' },
        ],
      },
    ],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 5000 }, closingBalances: { 'acc-1': 2000 },
  };
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1'] });
  assert.strictEqual(r.external.expenseOutflow, 3000, 'children summed once, parent excluded');
  assert.strictEqual(r.reconciliation.difference, 0, 'reconciles');
});

check('duplicate account ids do not double the balances (reconciliation stays exact)', () => {
  const snapshot = {
    transactions: [{ id: 'e1', date: '2025-01-05', amount: -5000, account: 'acc-1', category: 'cat-food' }],
    transferCounterparts: [], accounts, categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
    openingBalances: { 'acc-1': 10000 }, closingBalances: { 'acc-1': 5000 },
  };
  // 'acc-1' passed twice: rows dedupe via the Set, so balances must key off the same unique set.
  const r = summarizeAccountFlow(snapshot, { ...range, accountIds: ['acc-1', 'acc-1'] });
  assert.strictEqual(r.openingBalance, 10000, 'opening not doubled');
  assert.strictEqual(r.closingBalance, 5000, 'closing not doubled');
  assert.strictEqual(r.accounts.length, 1, 'accounts list deduped');
  assert.strictEqual(r.reconciliation.difference, 0, 'still reconciles exactly');
});

console.log('\n[account-flow] tool surface (#388 resolveFilterId + validation)');

// resolveFilterId's verifyExists path matches by real UUID, so the tool tests use one.
const ACC1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const originalSnapshot = adapter.getFinancialAnalysisSnapshot;
adapter.getFinancialAnalysisSnapshot = async () => ({
  transactions: [{ id: 'e1', date: '2025-01-05', amount: -5000, account: ACC1, category: 'cat-food' }],
  transferCounterparts: [], accounts: [{ id: ACC1, name: 'Checking' }], categories, categoryGroups: [{ id: 'g', name: 'G' }], payees: [],
  openingBalances: { [ACC1]: 10000 }, closingBalances: { [ACC1]: 5000 },
});

await acheck('POSITIVE: the tool reconciles end to end (difference 0)', async () => {
  const res = await flowTool.call({ startDate: '2025-01-01', endDate: '2025-01-31', accountIds: [ACC1] });
  const r = res.result ?? res;
  assert.strictEqual(r.external.expenseOutflow, 5000, 'the expense is counted');
  assert.strictEqual(r.reconciliation.difference, 0, 'reconciles exactly through the tool');
});

await acheck('NEGATIVE: an account NAME is refused with the resolved id (#388)', async () => {
  let thrown = null;
  try { await flowTool.call({ startDate: '2025-01-01', endDate: '2025-01-31', accountIds: ['Checking'] }); }
  catch (e) { thrown = e; }
  assert.ok(thrown && thrown.message.includes(ACC1), `name resolves to its id (got: ${thrown && thrown.message})`);
});

await acheck('NEGATIVE: endDate before startDate is rejected', async () => {
  let thrown = null;
  try { await flowTool.call({ startDate: '2025-02-01', endDate: '2025-01-01', accountIds: [ACC1] }); }
  catch (e) { thrown = e; }
  assert.ok(thrown && /endDate/.test(thrown.message));
});

adapter.getFinancialAnalysisSnapshot = originalSnapshot;

console.log(`\n[account-flow] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
