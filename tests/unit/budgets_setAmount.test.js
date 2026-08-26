// tests/unit/budgets_setAmount.test.js
// Regression test for #89: nil-UUID categoryId should return { success: false, error }, not {}
//
// Run via: npm run test:unit-js
// Or: node tests/unit/budgets_setAmount.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' — ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  // #361: these raw stubs MUST be installed before the adapter import. actual-adapter.ts
  // destructures the api functions at module load, so a stub applied afterwards is never
  // seen and the real function runs.
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  let rawSetCalls = 0;
  let budgetMonths = ['2026-01', '2026-02', '2026-03'];
  apiDefault.sync = async () => {};
  apiDefault.getCategories = async () => [{ id: 'cat-1', name: 'Food' }];
  apiDefault.getBudgetMonths = async () => budgetMonths;
  apiDefault.setBudgetAmount = async () => { rawSetCalls++; };

  const [toolMod, adapterMod] = await Promise.all([
    import('../../dist/src/tools/budgets_setAmount.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const tool    = toolMod;
  const adapter = adapterMod.default;

  // ── Negative path 1: nil UUID → { success: false, error }
  console.log('\n[#89] Negative path 1 — nil UUID returns structured error');
  {
    const nilUuid = '00000000-0000-0000-0000-000000000000';
    adapter.setBudgetAmount = async () => {
      throw new Error(`Category "${nilUuid}" not found. Use actual_categories_get to list available categories.`);
    };
    const res = await tool.call({ month: '2026-04', categoryId: nilUuid, amount: 50000 });
    check(res && res.success === false,                                'success is false for nil UUID');
    check(typeof res?.error === 'string',                              'error field is a string');
    check(res?.error?.toLowerCase().includes('not found'),             'error mentions "not found"');
    check(res?.error?.toLowerCase().includes('actual_categories_get'), 'error mentions actual_categories_get');
  }

  // ── Negative path 2: non-nil unknown UUID → same result (same code path)
  console.log('\n[#89] Negative path 2 — non-nil unknown UUID returns structured error');
  {
    const unknownUuid = '11111111-1111-1111-1111-111111111111';
    adapter.setBudgetAmount = async () => {
      throw new Error(`Category "${unknownUuid}" not found. Use actual_categories_get to list available categories.`);
    };
    const res = await tool.call({ month: '2026-04', categoryId: unknownUuid, amount: 50000 });
    check(res && res.success === false, 'success is false for non-nil unknown UUID');
    check(typeof res?.error === 'string', 'error field is a string');
  }

  // ── #361: the MONTH, which was entirely unvalidated ──────────────────────────
  // Exercised against the REAL adapter (raw stubs installed before the adapter import,
  // session disarmed), because the guard lives there. The pre-existing cases above stub
  // adapter.setBudgetAmount wholesale and so cannot reach it.
  {
    adapterMod._setSkipApiInitForTests(true);
    const realAdapter = adapterMod.default;
    // Restore the real method: the cases above replaced it with a stub.
    realAdapter.setBudgetAmount = adapterMod.setBudgetAmount;

    console.log('\n[#361] month must be one this budget actually has');
    {
      rawSetCalls = 0;
      let threw = null;
      try { await realAdapter.setBudgetAmount('2019-01', 'cat-1', 1000); } catch (e) { threw = e; }
      check(threw instanceof Error,                                     'an out-of-range month is refused');
      check(!!threw && /not in this budget/i.test(threw.message),        'message says it is not in the budget');
      check(!!threw && threw.message.includes('2026-01'),                'message names the first month available');
      check(!!threw && threw.message.includes('actual_budgets_getMonths'), 'message names the listing tool');
      check(rawSetCalls === 0,                                          'no write attempted for an out-of-range month');
    }

    console.log('\n[#361] the TOOL reports a month refusal in the same shape as a category refusal');
    {
      // Both are "you asked for something that does not exist"; a caller should not have to
      // parse two forms. Driven through the tool, not the adapter, because the shape is the
      // tool's contract.
      const res = await tool.call({ month: '2019-01', categoryId: 'cat-1', amount: 1000 });
      check(res?.success === false,                              'month refusal returns success:false, not a throw');
      check(/not in this budget/i.test(res?.error ?? ''),         'and carries the actionable message');
    }

  console.log('\n[#361] a month inside the budget still writes');
    {
      rawSetCalls = 0;
      let threw = null;
      try { await realAdapter.setBudgetAmount('2026-02', 'cat-1', 1000); } catch (e) { threw = e; }
      check(threw === null,       'an in-range month is accepted');
      check(rawSetCalls === 1,    'the write happened exactly once');
    }

    console.log('\n[#361] amount 0 is a legitimate budget value, not a falsy skip');
    {
      rawSetCalls = 0;
      await realAdapter.setBudgetAmount('2026-02', 'cat-1', 0);
      check(rawSetCalls === 1, 'setting a category back to zero reaches the write');
    }

    console.log('\n[#361] an empty months list does not block the write');
    {
      // Defensive: if upstream ever returns nothing, refusing every write would be worse
      // than the bug being fixed.
      budgetMonths = [];
      rawSetCalls = 0;
      await realAdapter.setBudgetAmount('2026-02', 'cat-1', 500);
      check(rawSetCalls === 1, 'an empty months list is treated as unknown, not as a refusal');
      budgetMonths = ['2026-01', '2026-02', '2026-03'];
    }
  }

  // ── Positive path: valid categoryId → { result }
  console.log('\n[#89] Positive path — valid categoryId returns { result }');
  {
    adapter.setBudgetAmount = async () => ({ budgeted: 50000 });
    const res = await tool.call({ month: '2026-04', categoryId: 'cat_1', amount: 50000 });
    check(res && 'result' in res,   'response has result key');
    check(res?.success !== false,   'success is not false on happy path');
  }

  console.log('');
  if (failures === 0) {
    console.log('[#89] All budgets_setAmount tests passed ✓');
  } else {
    console.error(`[#89] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
