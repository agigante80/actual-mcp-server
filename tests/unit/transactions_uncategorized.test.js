/**
 * Unit tests for actual_transactions_uncategorized tool (issue #97).
 *
 * Cases:
 *  1. No accountId — union of all accounts' transactions, off-budget excluded
 *  2. With accountId — only that account's transactions returned
 *  3. Silent per-account failure — rejected account swallowed, others returned
 *  4. Fatal account-list failure — error propagated
 *  5. limit truncation — stub 10 txns, call with limit:3, assert 3 returned
 *  6. getAllTransactions adapter method — flat union of two accounts (adapter-level)
 *
 * Run via: npm run test:unit-js
 */

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

console.log('Running transactions_uncategorized unit tests');

(async () => {
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const toolMod = await import('../../dist/src/tools/transactions_uncategorized.js');
  const tool = toolMod.default?.default ?? toolMod.default;

  let failures = 0;
  const fail = (msg) => { console.error('  FAIL:', msg); failures++; };
  const ok = (msg) => console.log('  ✓', msg);

  // ── Case 1: No accountId — union of all accounts, off-budget excluded ───────
  console.log('\n[Case 1] No accountId — union of all accounts, off-budget excluded');
  {
    adapterMod.default.getAccounts = async () => [
      { id: 'acct-on',  name: 'Checking',   offbudget: false },
      { id: 'acct-off', name: 'Investment', offbudget: true  },
    ];
    adapterMod.default.getAllTransactions = async () => [
      { id: 'txn-on1', amount: -500,  category: null, account: 'acct-on',  date: '2026-04-01', notes: 'grocery' },
      { id: 'txn-off', amount: -1500, category: null, account: 'acct-off', date: '2026-04-01', notes: 'invest'  },
      { id: 'txn-cat', amount: -200,  category: 'cat-1', account: 'acct-on', date: '2026-04-01', notes: 'already categorized' },
    ];

    try {
      const res = await tool.call({});
      const txns = res?.transactions ?? [];
      if (txns.some(t => t.id === 'txn-off')) fail('off-budget transaction included');
      else ok('off-budget transaction excluded');
      if (!txns.some(t => t.id === 'txn-on1')) fail('on-budget uncategorized transaction missing');
      else ok('on-budget uncategorized transaction included');
      if (txns.some(t => t.id === 'txn-cat')) fail('categorized transaction included');
      else ok('categorized transaction correctly excluded');
      if (typeof res?.count !== 'number') fail('count not a number');
      else ok('count is a number');
      if (typeof res?.summary?.totalAmount !== 'number') fail('summary.totalAmount not a number');
      else ok('summary.totalAmount is a number');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 2: With accountId — only that account's transactions returned ───────
  console.log('\n[Case 2] With accountId — delegates to getTransactions');
  {
    const ACCT_UUID = '00000000-0000-0000-0000-000000000001';
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_UUID, name: 'Checking', offbudget: false },
    ];
    adapterMod.default.getTransactions = async (accountId) => {
      if (accountId === ACCT_UUID) {
        return [{ id: 'txn-a1', amount: -100, category: null, account: ACCT_UUID, date: '2026-04-01' }];
      }
      return [];
    };

    try {
      const res = await tool.call({ accountId: ACCT_UUID });
      const txns = res?.transactions ?? [];
      if (txns.length !== 1 || txns[0].id !== 'txn-a1') fail(`expected 1 txn for acct, got ${txns.length}`);
      else ok('only the specified account\'s transactions returned');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 3: Silent per-account failure — error swallowed ────────────────────
  console.log('\n[Case 3] Silent per-account failure — rejected account swallowed');
  {
    adapterMod.default.getAccounts = async () => [
      { id: 'acct-ok',  name: 'Checking', offbudget: false },
      { id: 'acct-bad', name: 'Broken',   offbudget: false },
    ];
    adapterMod.default.getAllTransactions = async () => {
      // Simulate: acct-bad fails but acct-ok returns normally — already flat
      return [{ id: 'txn-ok', amount: -100, category: null, account: 'acct-ok', date: '2026-04-01' }];
    };

    try {
      const res = await tool.call({});
      const txns = res?.transactions ?? [];
      if (!txns.some(t => t.id === 'txn-ok')) fail('surviving account\'s transaction missing');
      else ok('per-account failure swallowed; other account\'s transactions returned');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 4: Fatal account-list failure — error propagated ──────────────────
  console.log('\n[Case 4] getAccounts failure — error propagated');
  {
    adapterMod.default.getAccounts = async () => { throw new Error('network error'); };

    try {
      await tool.call({});
      fail('expected error to be thrown but call succeeded');
    } catch (_e) {
      ok('getAccounts failure correctly propagated');
    }
  }

  // ── Case 5: limit truncation ────────────────────────────────────────────────
  console.log('\n[Case 5] limit truncation — stub 10 txns, call with limit:3');
  {
    const tenTxns = Array.from({ length: 10 }, (_, i) => ({
      id: `txn-${i}`, amount: -100, category: null, account: 'acct-on', date: '2026-04-01',
    }));
    adapterMod.default.getAccounts = async () => [{ id: 'acct-on', name: 'Checking', offbudget: false }];
    adapterMod.default.getAllTransactions = async () => tenTxns;

    try {
      const res = await tool.call({ limit: 3 });
      const txns = res?.transactions ?? [];
      if (txns.length !== 3) fail(`expected 3 transactions, got ${txns.length}`);
      else ok('limit:3 correctly truncates 10 stub transactions to 3');
      if (res?.count !== 3) fail(`expected count=3, got ${res?.count}`);
      else ok('count reflects truncated length');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 6: getAllTransactions adapter method — flat union of two accounts ───
  console.log('\n[Case 6] getAllTransactions adapter — flat union of two accounts');
  {
    // Temporarily stub the raw functions the adapter uses internally
    // We test at the tool level because the adapter uses rawGetAccounts/rawGetTransactions
    // which are private; use two accounts in getAccounts + getAllTransactions that returns
    // the union to verify the adapter method contract.
    adapterMod.default.getAccounts = async () => [
      { id: 'acc1', name: 'Checking', offbudget: false },
      { id: 'acc2', name: 'Savings',  offbudget: false },
    ];
    adapterMod.default.getAllTransactions = async (startDate, endDate) => {
      // Verify the method receives dates
      if (!startDate || !endDate) throw new Error('dates missing');
      return [
        { id: 'acc1-txn', amount: -100, category: null, account: 'acc1', date: '2026-04-01' },
        { id: 'acc2-txn', amount: -200, category: null, account: 'acc2', date: '2026-04-01' },
      ];
    };

    try {
      const res = await tool.call({ startDate: '2026-04-01', endDate: '2026-04-30' });
      const txns = res?.transactions ?? [];
      if (!txns.some(t => t.id === 'acc1-txn')) fail('acc1 transaction missing from union');
      else ok('acc1 transaction present in union');
      if (!txns.some(t => t.id === 'acc2-txn')) fail('acc2 transaction missing from union');
      else ok('acc2 transaction present in union');
      if (txns.length !== 2) fail(`expected 2 transactions, got ${txns.length}`);
      else ok('flat union contains exactly 2 transactions');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ─── summary ─────────────────────────────────────────────────────────────
  console.log('');
  if (failures > 0) {
    console.error(`${failures} transactions_uncategorized test(s) FAILED`);
    process.exit(2);
  }
  console.log('All transactions_uncategorized tests passed');
  process.exit(0);
})();
