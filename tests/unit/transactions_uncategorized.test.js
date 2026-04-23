/**
 * Unit tests for actual_transactions_uncategorized tool (issue #121 upgrade).
 *
 * Cases:
 *  1.  Default call — summary only; totalCount, totalAmount, byAccount present; no transactions key
 *  2.  includeTransactions:true — all summary fields + transactions, count, hasMore, offset, limit
 *  3.  accountId filter — byAccount scoped to one account, totalCount reflects that account only
 *  4.  Pagination — hasMore:true (limit:2, offset:0, 5 txns)
 *  5.  Pagination — hasMore:false (limit:2, offset:4, 5 txns)
 *  6.  Transfer exclusion — txn with transfer_id not counted (issue #119)
 *  7.  Closed account exclusion — txn on closed account not in totalCount or byAccount (issue #119)
 *  8.  summary.totalAmount removed — result.summary is undefined
 *  9.  No accountId — full scan, off-budget excluded from totalCount and byAccount
 * 10.  With accountId — getTransactions called with the specific accountId
 * 11.  getAccounts failure — error propagated
 * 12.  Limit truncation with includeTransactions — limit:3 returns 3 of 10 txns
 * 13.  Multiple accounts in byAccount breakdown
 * 14.  Empty transaction list — totalCount:0, byAccount:[]
 * 15.  Invalid accountId (non-UUID) — Zod validation error thrown
 * 16.  Split parent exclusion — is_parent:true not in totalCount (issue #119)
 * 17.  Opening balance exclusion — starting_balance_flag:true not in totalCount (issue #119)
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

  const ACCT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const ACCT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

  // ── Case 1: Default call — summary only, no transactions key ───────────────
  console.log('\n[Case 1] Default call — summary only; no transactions key');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-1', amount: -500,  category: null, account: ACCT_A, date: '2026-04-01' },
      { id: 'txn-2', amount: -1000, category: null, account: ACCT_B, date: '2026-04-01' },
      { id: 'txn-3', amount: -200,  category: 'cat-1', account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
      { id: ACCT_B, name: 'Savings',  offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.totalCount !== 2) fail(`expected totalCount:2, got ${res?.totalCount}`);
      else ok('totalCount is 2');
      if (typeof res?.totalAmount !== 'number') fail('totalAmount not a number');
      else ok('totalAmount is a number');
      if (!Array.isArray(res?.byAccount)) fail('byAccount not an array');
      else ok('byAccount is an array');
      if (res?.byAccount?.length !== 2) fail(`expected 2 byAccount entries, got ${res?.byAccount?.length}`);
      else ok('byAccount has 2 entries');
      if ('transactions' in (res ?? {})) fail('transactions key must be absent by default');
      else ok('transactions key absent (summary-only mode)');
      if (res?.dateRange?.startDate === undefined) fail('dateRange.startDate missing');
      else ok('dateRange present');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 2: includeTransactions:true — all fields present ─────────────────
  console.log('\n[Case 2] includeTransactions:true — all summary + list fields present');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-1', amount: -500, category: null, account: ACCT_A, date: '2026-04-01' },
      { id: 'txn-2', amount: -300, category: null, account: ACCT_B, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
      { id: ACCT_B, name: 'Savings',  offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({ includeTransactions: true });
      if (typeof res?.totalCount !== 'number') fail('totalCount not a number');
      else ok('totalCount present');
      if (typeof res?.totalAmount !== 'number') fail('totalAmount not a number');
      else ok('totalAmount present');
      if (!Array.isArray(res?.byAccount)) fail('byAccount not an array');
      else ok('byAccount present');
      if (!Array.isArray(res?.transactions)) fail('transactions not an array');
      else ok('transactions present');
      if (typeof res?.count !== 'number') fail('count not a number');
      else ok('count present');
      if (typeof res?.hasMore !== 'boolean') fail('hasMore not a boolean');
      else ok('hasMore present');
      if (typeof res?.offset !== 'number') fail('offset not a number');
      else ok('offset present');
      if (typeof res?.limit !== 'number') fail('limit not a number');
      else ok('limit present');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 3: accountId filter — byAccount scoped to one account ────────────
  console.log('\n[Case 3] accountId filter — byAccount has exactly 1 entry, totalCount scoped');
  {
    adapterMod.default.getTransactions = async (accountId) => {
      if (accountId === ACCT_A) {
        return [{ id: 'txn-a1', amount: -100, category: null, account: ACCT_A, date: '2026-04-01' }];
      }
      return [];
    };
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
      { id: ACCT_B, name: 'Savings',  offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({ accountId: ACCT_A });
      if (res?.totalCount !== 1) fail(`expected totalCount:1, got ${res?.totalCount}`);
      else ok('totalCount:1 for filtered account');
      if (res?.byAccount?.length !== 1) fail(`expected 1 byAccount entry, got ${res?.byAccount?.length}`);
      else ok('byAccount has exactly 1 entry');
      if (res?.byAccount?.[0]?.accountId !== ACCT_A) fail('byAccount entry is not the requested account');
      else ok('byAccount entry matches requested accountId');
      if (res?.byAccount?.[0]?.accountName !== 'Checking') fail('byAccount entry has wrong name');
      else ok('byAccount entry has correct accountName');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 4: Pagination — hasMore:true ─────────────────────────────────────
  console.log('\n[Case 4] Pagination — hasMore:true (limit:2, offset:0, 5 txns)');
  {
    const fiveTxns = Array.from({ length: 5 }, (_, i) => ({
      id: `txn-${i}`, amount: -100, category: null, account: ACCT_A, date: '2026-04-01',
    }));
    adapterMod.default.getTransactions = async () => fiveTxns;
    adapterMod.default.getAccounts = async () => [{ id: ACCT_A, name: 'Checking', offbudget: false, closed: false }];

    try {
      const res = await tool.call({ includeTransactions: true, limit: 2, offset: 0 });
      if (res?.count !== 2) fail(`expected count:2, got ${res?.count}`);
      else ok('count:2 for limit:2');
      if (res?.hasMore !== true) fail(`expected hasMore:true, got ${res?.hasMore}`);
      else ok('hasMore:true');
      if (res?.totalCount !== 5) fail(`expected totalCount:5, got ${res?.totalCount}`);
      else ok('totalCount:5 (full count before limit)');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 5: Pagination — hasMore:false ────────────────────────────────────
  console.log('\n[Case 5] Pagination — hasMore:false (limit:2, offset:4, 5 txns)');
  {
    const fiveTxns = Array.from({ length: 5 }, (_, i) => ({
      id: `txn-${i}`, amount: -100, category: null, account: ACCT_A, date: '2026-04-01',
    }));
    adapterMod.default.getTransactions = async () => fiveTxns;
    adapterMod.default.getAccounts = async () => [{ id: ACCT_A, name: 'Checking', offbudget: false, closed: false }];

    try {
      const res = await tool.call({ includeTransactions: true, limit: 2, offset: 4 });
      if (res?.count !== 1) fail(`expected count:1, got ${res?.count}`);
      else ok('count:1 (only 1 txn at offset:4)');
      if (res?.hasMore !== false) fail(`expected hasMore:false, got ${res?.hasMore}`);
      else ok('hasMore:false (last page)');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 6: Transfer exclusion — transfer_id set → not counted ────────────
  console.log('\n[Case 6] Transfer exclusion — txn with transfer_id not in totalCount (issue #119)');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-transfer', amount: -5000, category: null, account: ACCT_A, date: '2026-04-01', transfer_id: 'paired-id' },
      { id: 'txn-normal',   amount: -100,  category: null, account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.totalCount !== 1) fail(`expected totalCount:1 (transfer excluded), got ${res?.totalCount}`);
      else ok('transfer excluded from totalCount');
      if (res?.byAccount?.[0]?.count !== 1) fail('transfer incorrectly counted in byAccount');
      else ok('transfer excluded from byAccount count');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 7: Closed account exclusion ─────────────────────────────────────
  console.log('\n[Case 7] Closed account exclusion — txn on closed account not in totalCount (issue #119)');
  {
    const CLOSED = 'cccccccc-0000-0000-0000-000000000003';
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-closed', amount: -200, category: null, account: CLOSED, date: '2026-04-01' },
      { id: 'txn-open',   amount: -100, category: null, account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: CLOSED, name: 'OldCard',  offbudget: false, closed: true  },
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.totalCount !== 1) fail(`expected totalCount:1, got ${res?.totalCount}`);
      else ok('closed account transaction excluded from totalCount');
      const closedEntry = (res?.byAccount ?? []).find(a => a.accountId === CLOSED);
      if (closedEntry) fail('closed account appears in byAccount');
      else ok('closed account absent from byAccount');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 8: summary.totalAmount removed — result.summary is undefined ─────
  console.log('\n[Case 8] summary.totalAmount removed — result.summary is undefined');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-1', amount: -100, category: null, account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.summary !== undefined) fail('legacy summary key should not exist');
      else ok('result.summary is absent (breaking change expected)');
      if (typeof res?.totalAmount !== 'number') fail('totalAmount not at top level');
      else ok('totalAmount is at top level');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 9: No accountId — off-budget excluded from totalCount and byAccount
  console.log('\n[Case 9] No accountId — off-budget excluded from totalCount and byAccount');
  {
    const OFFBUDGET = 'dddddddd-0000-0000-0000-000000000004';
    let capturedAccountId = 'NOT_SET';
    adapterMod.default.getTransactions = async (accountId) => {
      capturedAccountId = accountId;
      return [
        { id: 'txn-on',  amount: -500,  category: null, account: ACCT_A,    date: '2026-04-01' },
        { id: 'txn-off', amount: -1500, category: null, account: OFFBUDGET,  date: '2026-04-01' },
        { id: 'txn-cat', amount: -200,  category: 'cat-1', account: ACCT_A,  date: '2026-04-01' },
      ];
    };
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A,    name: 'Checking',   offbudget: false },
      { id: OFFBUDGET, name: 'Investment', offbudget: true  },
    ];

    try {
      const res = await tool.call({});
      if (capturedAccountId !== undefined) fail(`expected getTransactions called with undefined, got ${JSON.stringify(capturedAccountId)}`);
      else ok('getTransactions called with undefined (full table scan)');
      if (res?.totalCount !== 1) fail(`expected totalCount:1, got ${res?.totalCount}`);
      else ok('totalCount:1 (off-budget + categorized excluded)');
      const offEntry = (res?.byAccount ?? []).find(a => a.accountId === OFFBUDGET);
      if (offEntry) fail('off-budget account appears in byAccount');
      else ok('off-budget account absent from byAccount');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 10: With accountId — getTransactions scoped ─────────────────────
  console.log('\n[Case 10] With accountId — getTransactions called with the specific accountId');
  {
    let capturedId = 'NOT_SET';
    adapterMod.default.getTransactions = async (accountId) => {
      capturedId = accountId;
      return [{ id: 'txn-a1', amount: -100, category: null, account: ACCT_A, date: '2026-04-01' }];
    };
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
    ];

    try {
      await tool.call({ accountId: ACCT_A });
      if (capturedId !== ACCT_A) fail(`expected getTransactions called with ${ACCT_A}, got ${capturedId}`);
      else ok('getTransactions called with specified accountId');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 11: getAccounts failure — error propagated ───────────────────────
  console.log('\n[Case 11] getAccounts failure — error propagated');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-x', amount: -100, category: null, account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => { throw new Error('network error'); };

    try {
      await tool.call({});
      fail('expected error to be thrown but call succeeded');
    } catch (_e) {
      ok('getAccounts failure correctly propagated');
    }
  }

  // ── Case 12: Limit truncation with includeTransactions ────────────────────
  console.log('\n[Case 12] Limit truncation with includeTransactions — limit:3 of 10 txns');
  {
    const tenTxns = Array.from({ length: 10 }, (_, i) => ({
      id: `txn-${i}`, amount: -100, category: null, account: ACCT_A, date: '2026-04-01',
    }));
    adapterMod.default.getTransactions = async () => tenTxns;
    adapterMod.default.getAccounts = async () => [{ id: ACCT_A, name: 'Checking', offbudget: false, closed: false }];

    try {
      const res = await tool.call({ includeTransactions: true, limit: 3 });
      if ((res?.transactions ?? []).length !== 3) fail(`expected 3 transactions, got ${(res?.transactions ?? []).length}`);
      else ok('limit:3 correctly truncates 10 transactions to 3');
      if (res?.count !== 3) fail(`expected count:3, got ${res?.count}`);
      else ok('count reflects page length');
      if (res?.totalCount !== 10) fail(`expected totalCount:10, got ${res?.totalCount}`);
      else ok('totalCount:10 (full set before paging)');
      if (res?.hasMore !== true) fail('hasMore should be true');
      else ok('hasMore:true');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 13: Multiple accounts in byAccount breakdown ─────────────────────
  console.log('\n[Case 13] Multiple accounts in byAccount breakdown');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-a1', amount: -100, category: null, account: ACCT_A, date: '2026-04-01' },
      { id: 'txn-a2', amount: -200, category: null, account: ACCT_A, date: '2026-04-01' },
      { id: 'txn-b1', amount: -500, category: null, account: ACCT_B, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
      { id: ACCT_B, name: 'Savings',  offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.byAccount?.length !== 2) fail(`expected 2 byAccount entries, got ${res?.byAccount?.length}`);
      else ok('byAccount has 2 entries');
      const entryA = (res?.byAccount ?? []).find(a => a.accountId === ACCT_A);
      const entryB = (res?.byAccount ?? []).find(a => a.accountId === ACCT_B);
      if (!entryA || entryA.count !== 2 || entryA.totalAmount !== -300) fail(`ACCT_A entry wrong: ${JSON.stringify(entryA)}`);
      else ok('ACCT_A: count:2, totalAmount:-300');
      if (!entryB || entryB.count !== 1 || entryB.totalAmount !== -500) fail(`ACCT_B entry wrong: ${JSON.stringify(entryB)}`);
      else ok('ACCT_B: count:1, totalAmount:-500');
      if (entryA?.accountName !== 'Checking') fail('ACCT_A accountName wrong');
      else ok('accountName resolved correctly from accounts list');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 14: Empty transaction list ───────────────────────────────────────
  console.log('\n[Case 14] Empty transaction list — totalCount:0, byAccount:[]');
  {
    adapterMod.default.getTransactions = async () => [];
    adapterMod.default.getAccounts = async () => [];

    try {
      const res = await tool.call({});
      if (res?.totalCount !== 0) fail(`expected totalCount:0, got ${res?.totalCount}`);
      else ok('totalCount:0');
      if (res?.totalAmount !== 0) fail(`expected totalAmount:0, got ${res?.totalAmount}`);
      else ok('totalAmount:0');
      if (!Array.isArray(res?.byAccount) || res?.byAccount?.length !== 0) fail('byAccount should be empty array');
      else ok('byAccount:[]');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 15: Invalid accountId (non-UUID) — Zod validation error ──────────
  console.log('\n[Case 15] Invalid accountId (non-UUID string) — Zod validation error thrown');
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

  // ── Case 16: Split parent exclusion ──────────────────────────────────────
  console.log('\n[Case 16] Split parent exclusion — is_parent:true not in totalCount (issue #119)');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-parent', amount: -300, category: null, account: ACCT_A, date: '2026-04-01', is_parent: true },
      { id: 'txn-normal', amount: -100, category: null, account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.totalCount !== 1) fail(`expected totalCount:1 (parent excluded), got ${res?.totalCount}`);
      else ok('split parent excluded from totalCount');
    } catch (e) {
      fail(`unexpected error: ${e && e.message}`);
    }
  }

  // ── Case 17: Opening balance exclusion ────────────────────────────────────
  console.log('\n[Case 17] Opening balance exclusion — starting_balance_flag:true not in totalCount (issue #119)');
  {
    adapterMod.default.getTransactions = async () => [
      { id: 'txn-openbal', amount: 100000, category: null, account: ACCT_A, date: '2026-04-01', starting_balance_flag: true },
      { id: 'txn-normal',  amount:   -100, category: null, account: ACCT_A, date: '2026-04-01' },
    ];
    adapterMod.default.getAccounts = async () => [
      { id: ACCT_A, name: 'Checking', offbudget: false, closed: false },
    ];

    try {
      const res = await tool.call({});
      if (res?.totalCount !== 1) fail(`expected totalCount:1 (opening balance excluded), got ${res?.totalCount}`);
      else ok('opening balance excluded from totalCount');
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
