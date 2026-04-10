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
