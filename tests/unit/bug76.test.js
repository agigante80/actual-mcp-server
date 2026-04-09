/**
 * Regression tests for GitHub issue #76:
 *   Bug 1 — actual_transactions_search_by_category returns 0 results (no accountId)
 *   Bug 2 — actual_transactions_summary_by_payee returns empty (runQuery returns { data: [] })
 *   Bug 3 — actual_query_run WHERE on joined fields (category.name) silently ignored
 *
 * Run via: npm run test:unit-js   (included in the chain)
 * Or directly: node tests/unit/bug76.test.js
 */

// Stub required env vars so the adapter can be imported without a .env
process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;

function pass(label) {
  console.log(`  ✓ ${label}`);
}

function fail(label, detail = '') {
  console.error(`  ✗ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
  failures++;
}

function check(condition, label, detail = '') {
  if (condition) pass(label);
  else fail(label, detail);
}

(async () => {
  // ─── Load tools and adapter from compiled dist ────────────────────────────
  const [
    searchByCategory,
    summaryByPayee,
    adapterMod,
    { parseWhereClause },
  ] = await Promise.all([
    import('../../dist/src/tools/transactions_search_by_category.js').then(m => m.default),
    import('../../dist/src/tools/transactions_summary_by_payee.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);

  const adapter = adapterMod.default;

  // ─── Bug 1: search_by_category — multi-account fetch ─────────────────────
  console.log('\n[bug76] Bug 1 — actual_transactions_search_by_category: 0 results when no accountId');

  {
    // Two accounts, each with different transactions
    const accountA = { id: 'acc-a', name: 'Checking' };
    const accountB = { id: 'acc-b', name: 'Savings' };
    const catId    = 'cat-epicierie';

    // Reset stubs before each sub-test
    adapter.getAccounts   = async () => [accountA, accountB];
    adapter.getCategories = async () => [{ id: catId, name: 'Épicerie' }];
    adapter.getTransactions = async (accountId) => {
      if (accountId === 'acc-a') {
        return [{ id: 't1', account: 'acc-a', category: catId,  amount: -5000 }];
      }
      if (accountId === 'acc-b') {
        return [{ id: 't2', account: 'acc-b', category: 'other', amount: -1000 }];
      }
      return [];
    };

    const result = await searchByCategory.call({ categoryName: 'Épicerie' });
    check(result.count > 0,                               'count > 0 when no accountId (was 0 before fix)');
    check(result.count === 1,                             'exactly 1 matching transaction found');
    check(result.transactions[0]?.category === catId,    'returned transaction has correct category');
    check(result.totalAmount === -5000,                   'totalAmount matches the one matching transaction');
  }

  {
    // Deduplication: same transaction id in both accounts (split tx)
    const catId = 'cat-x';
    adapter.getAccounts   = async () => [{ id: 'acc-1', name: 'A' }, { id: 'acc-2', name: 'B' }];
    adapter.getCategories = async () => [{ id: catId, name: 'Food' }];
    adapter.getTransactions = async () => [{ id: 'dup-tx', account: 'acc-1', category: catId, amount: -200 }];

    const result = await searchByCategory.call({ categoryName: 'Food' });
    check(result.count === 1, 'duplicate transaction ids are deduplicated');
  }

  // ─── Bug 2: summary_by_payee — { data: [...] } unwrapping ─────────────────
  console.log('\n[bug76] Bug 2 — actual_transactions_summary_by_payee: empty when runQuery returns { data: [...] }');

  {
    // Simulate the real @actual-app/api runQuery response shape
    adapter.runQuery = async () => ({
      data: [
        { 'payee.name': 'Kroger', totalAmount: -50000, transactionCount: 10 },
        { 'payee.name': 'Netflix', totalAmount: -1500, transactionCount: 1 },
      ],
    });

    const result = await summaryByPayee.call({ startDate: '2025-01-01', endDate: '2025-12-31' });
    // Tool sorts descending by totalAmount: -1500 > -50000, so Netflix comes first
    const kroger = result.summary.find(r => r.payeeName === 'Kroger');
    const netflix = result.summary.find(r => r.payeeName === 'Netflix');
    check(Array.isArray(result.summary),                  'summary is an array');
    check(result.summary.length === 2,                    'summary has 2 entries (was empty before fix)');
    check(kroger !== undefined,                           'Kroger entry exists in summary');
    check(kroger?.totalAmount === -50000,                 'Kroger totalAmount matches');
    check(kroger?.transactionCount === 10,                'Kroger transactionCount matches');
    check(netflix !== undefined,                          'Netflix entry exists in summary');
    check(result.totalAmount === -51500,                  'grand totalAmount is sum of all entries');
  }

  {
    // Bare array (stub behaviour) should also still work
    adapter.runQuery = async () => [
      { 'payee.name': 'Amazon', totalAmount: -3000, transactionCount: 2 },
    ];

    const result = await summaryByPayee.call({ startDate: '2025-01-01', endDate: '2025-12-31' });
    check(result.summary.length === 1, 'bare array response also handled correctly');
  }

  // ─── Bug 3: parseWhereClause — dotted field names ─────────────────────────
  console.log('\n[bug76] Bug 3 — parseWhereClause: WHERE on joined fields (category.name) silently ignored');

  {
    // Build a minimal mock query object that records .filter() calls
    function mockQuery() {
      const calls = [];
      const q = {
        _calls: calls,
        filter(cond) { calls.push(cond); return q; },
      };
      return q;
    }

    // category.name = 'Épicerie'
    {
      const q = mockQuery();
      parseWhereClause(q, "category.name = 'Épicerie'");
      check(q._calls.length === 1,                              "category.name equality: filter was called");
      check(
        JSON.stringify(q._calls[0]) === JSON.stringify({ 'category.name': 'Épicerie' }),
        "category.name equality: correct filter object",
        `got: ${JSON.stringify(q._calls[0])}`
      );
    }

    // payee.name = 'Kroger'
    {
      const q = mockQuery();
      parseWhereClause(q, "payee.name = 'Kroger'");
      check(q._calls.length === 1,                              "payee.name equality: filter was called");
      check(
        JSON.stringify(q._calls[0]) === JSON.stringify({ 'payee.name': 'Kroger' }),
        "payee.name equality: correct filter object",
        `got: ${JSON.stringify(q._calls[0])}`
      );
    }

    // Simple non-joined field still works: amount < -1000
    {
      const q = mockQuery();
      parseWhereClause(q, 'amount < -1000');
      check(q._calls.length === 1, 'simple field (amount): filter was called');
      check(
        JSON.stringify(q._calls[0]) === JSON.stringify({ amount: { $lt: -1000 } }),
        'simple field (amount): correct $lt filter',
        `got: ${JSON.stringify(q._calls[0])}`
      );
    }

    // AND with mixed joined + simple fields
    {
      const q = mockQuery();
      parseWhereClause(q, "category.name = 'Food' AND amount < 0");
      check(q._calls.length === 2,                              'AND with 2 conditions: 2 filter calls');
      check(
        JSON.stringify(q._calls[0]) === JSON.stringify({ 'category.name': 'Food' }),
        'AND: first filter is category.name',
        `got: ${JSON.stringify(q._calls[0])}`
      );
      check(
        JSON.stringify(q._calls[1]) === JSON.stringify({ amount: { $lt: 0 } }),
        'AND: second filter is amount < 0',
        `got: ${JSON.stringify(q._calls[1])}`
      );
    }

    // IN clause with dotted field (e.g. category.name IN ('Food', 'Rent'))
    {
      const q = mockQuery();
      parseWhereClause(q, "category.name IN ('Food', 'Rent')");
      check(q._calls.length === 1,                              'IN clause on joined field: filter was called');
      check(
        JSON.stringify(q._calls[0]) === JSON.stringify({ 'category.name': { $oneof: ['Food', 'Rent'] } }),
        'IN clause on joined field: correct $oneof filter',
        `got: ${JSON.stringify(q._calls[0])}`
      );
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  if (failures === 0) {
    console.log('[bug76] All regression tests passed ✓');
  } else {
    console.error(`[bug76] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
