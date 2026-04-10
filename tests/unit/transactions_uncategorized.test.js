/**
 * Unit tests for actual_transactions_uncategorized tool (issue #104).
 *
 * Cases:
 *  1. No accountId — getTransactions(undefined, ...) full scan, off-budget excluded
 *  2. With accountId — getTransactions(accountId, ...) scoped result
 *  3. Silent off-budget exclusion — on-budget returned, off-budget filtered
 *  4. Fatal account-list failure — getAccounts error propagated
 *  5. limit truncation — stub 10 txns, call with limit:3, assert 3 returned
 *  6. getTransactions returns flat list including multiple account txns
 *  7. Empty transaction list returns empty result
 *  8. Invalid accountId (non-UUID) — Zod validation error thrown
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

  // ── Case 1: No accountId — getTransactions(undefined) full scan, off-budget excluded ───
  console.log('\n[Case 1] No accountId — getTransactions(undefined) full scan, off-budget excluded');
  {
    let capturedAccountId = 'NOT_SET';
    adapterMod.default.getTransactions = async (accountId, startDate, endDate) => {
      capturedAccountId = accountId;
      return [
        { id: 'txn-on1', amount: -500,  category: null,    account: 'acct-on',  date: '2026-04-01', notes: 'grocery' },
        { id: 'txn-off', amount: -1500, category: null,    account: 'acct-off', date: '2026-04-01', notes: 'invest'  },
        { id: 'txn-cat', amount: -200,  category: 'cat-1', account: 'acct-on',  date: '2026-04-01', notes: 'already categorized' },
      ];
    };
    adapterMod.default.getAccounts = async () => [
      { id: 'acct-on',  name: 'Checking',   offbudget: false },
      { id: 'acct-off', name: 'Investment', offbudget: true  },
    ];

    try {
      const res = await tool.call({});
      if (capturedAccountId !== undefined) fail(`expected getTransactions called with undefined, got ${JSON.stringify(capturedAccountId)}`);
      else ok('getTransactions called with undefined (full table scan)');
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

  // ── Case 2: With accountId — delegates to getTransactions(accountId, ...) ──
  console.log('\n[Case 2] With accountId — delegates to getTransactions(accountId, ...)');
  {
    const ACCT_UUID = '00000000-0000-0000-0000-000000000001';
    let capturedAccountId = 'NOT_SET';
    adapterMod.default.getTransactions = async (accountId) => {
      capturedAccountId = accountId;
      if (accountId === ACCT_UUID) {
        return [{ id: 'txn-a1', amount: -100, category: null, account: ACCT_UUID, date: '2026-04-01' }];
      }
      return [];
    };
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_UUID, name: 'Checking', offbudget: false },
    ];

    try {
      const res = await tool.call({ accountId: ACCT_UUID });
      if (capturedAccountId !== ACCT_UUID) fail(`expected getTransactions called with ${ACCT_UUID}, got ${capturedAccountId}`);
      else ok('getTransactions called with the specified accountId');
      const txns = res?.transactions ?? [];
      if (txns.length !== 1 || txns[0].id !== 'txn-a1') fail(`expected 1 txn for acct, got ${txns.length}`);
      else ok('only the specified account\'s transactions returned');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 3: Off-budget exclusion with on-budget and off-budget txns ─────────
  console.log('\n[Case 3] Off-budget exclusion — on-budget returned, off-budget filtered');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-ok',  amount: -100, category: null, account: 'acct-ok',  date: '2026-04-01' },
      { id: 'txn-bad', amount: -200, category: null, account: 'acct-bad', date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: 'acct-ok',  name: 'Checking', offbudget: false },
      { id: 'acct-bad', name: 'Invest',   offbudget: true  },
    ];

    try {
      const res = await tool.call({});
      const txns = res?.transactions ?? [];
      if (!txns.some(t => t.id === 'txn-ok')) fail('on-budget transaction missing');
      else ok('on-budget transaction present');
      if (txns.some(t => t.id === 'txn-bad')) fail('off-budget transaction incorrectly included');
      else ok('off-budget transaction correctly excluded');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 4: Fatal account-list failure — error propagated ──────────────────
  console.log('\n[Case 4] getAccounts failure — error propagated');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-x', amount: -100, category: null, account: 'acct-x', date: '2026-04-01' },
    ];
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
    adapterMod.default.getTransactions = async () => tenTxns;
    adapterMod.default.getAccounts = async () => [{ id: 'acct-on', name: 'Checking', offbudget: false }];

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

  // ── Case 6: getTransactions returns flat list including multiple accounts ───
  console.log('\n[Case 6] getTransactions returns flat union of transactions from multiple accounts');
  {
    adapterMod.default.getTransactions = async (accountId, startDate, endDate) => {
      if (!startDate || !endDate) throw new Error('dates missing');
      return [
        { id: 'acc1-txn', amount: -100, category: null, account: 'acc1', date: '2026-04-01' },
        { id: 'acc2-txn', amount: -200, category: null, account: 'acc2', date: '2026-04-01' },
      ];
    };
    adapterMod.default.getAccounts = async () => [
      { id: 'acc1', name: 'Checking', offbudget: false },
      { id: 'acc2', name: 'Savings',  offbudget: false },
    ];

    try {
      const res = await tool.call({ startDate: '2026-04-01', endDate: '2026-04-30' });
      const txns = res?.transactions ?? [];
      if (!txns.some(t => t.id === 'acc1-txn')) fail('acc1 transaction missing');
      else ok('acc1 transaction present');
      if (!txns.some(t => t.id === 'acc2-txn')) fail('acc2 transaction missing');
      else ok('acc2 transaction present');
      if (txns.length !== 2) fail(`expected 2 transactions, got ${txns.length}`);
      else ok('flat list contains exactly 2 transactions');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 7: Empty transaction list returns empty result ─────────────────────
  console.log('\n[Case 7] Empty transaction list returns empty result without crashing');
  {
    adapterMod.default.getTransactions = async () => [];
    adapterMod.default.getAccounts = async () => [];

    try {
      const res = await tool.call({ startDate: '2026-04-01', endDate: '2026-04-30' });
      const txns = res?.transactions ?? [];
      if (txns.length !== 0) fail(`expected 0 transactions, got ${txns.length}`);
      else ok('empty transaction list returns empty result without crashing');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 8: Invalid accountId (non-UUID) — Zod validation error ─────────────
  console.log('\n[Case 8] Invalid accountId (non-UUID string) — Zod validation error thrown');
  {
    adapterMod.default.getTransactions = async () => [];
    adapterMod.default.getAccounts = async () => [];

    try {
      await tool.call({ accountId: 'not-a-uuid' });
      fail('expected Zod validation error for non-UUID accountId, but call succeeded');
    } catch (e) {
      if (e && (e.name === 'ZodError' || (e.message && e.message.includes('Invalid')))) {
        ok('non-UUID accountId correctly throws Zod validation error');
      } else {
        fail(`expected ZodError, got: ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
      }
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
