// tests/unit/budgets_hold_for_next_month.test.js
// #355: actual_budgets_holdForNextMonth must not report success when upstream
// refused to hold anything.
//
// Upstream `holdForNextMonth` (loot-core/src/server/budget/actions.ts) returns a
// BOOLEAN: true when it buffered the amount, false when the month's To Budget is
// not positive and it held nothing. The published API reference documents the
// method as `Promise<null>`, which is why the return value was being discarded.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/budgets_holdForNextMonth.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  // Stub at the ADAPTER seam, the idiom used by tests/unit/budgets_setAmount.test.js.
  // Stubbing the raw @actual-app/api function is not enough: the adapter would still
  // open a session and try to reach a live server.
  let holdResult = true;
  let holdCalls = 0;
  let lastArgs = null;
  const originalHold = adapter.holdBudgetForNextMonth;
  adapter.holdBudgetForNextMonth = async (month, amount) => {
    holdCalls++;
    lastArgs = [month, amount];
    return holdResult;
  };

  const reset = () => { holdCalls = 0; lastArgs = null; holdResult = true; };

  console.log('\n[#355] holdForNextMonth: positive, upstream held the amount');
  {
    reset();
    holdResult = true;
    const res = await tool.call({ month: '2026-01', amount: 25000 });
    check(res?.success === true,            'returns success: true');
    check(holdCalls === 1,                  'raw holdBudgetForNextMonth called exactly once');
    check(lastArgs?.[0] === '2026-01',      'month forwarded unchanged');
    check(lastArgs?.[1] === 25000,          'amount forwarded unchanged (integer cents)');
  }

  console.log('\n[#355] holdForNextMonth: negative, upstream held nothing');
  {
    reset();
    holdResult = false;
    let threw = null;
    try { await tool.call({ month: '2026-02', amount: 25000 }); } catch (e) { threw = e; }
    check(threw instanceof Error,                      'throws instead of reporting success');
    check(!!threw && /2026-02/.test(threw.message),    'error names the month');
    check(!!threw && /nothing was held|not held/i.test(threw.message),
                                                       'error says nothing was held');
    check(!!threw && /to budget/i.test(threw.message), 'error explains why (To Budget)');
    check(holdCalls === 1,                             'the write was still attempted exactly once');
  }

  console.log('\n[#355] holdForNextMonth: back-compat, upstream returned no value');
  {
    // An older @actual-app/api, or any build that returns undefined here, must keep
    // working. Only an EXPLICIT false is a refusal; undefined is not evidence of one.
    reset();
    holdResult = undefined;
    const res = await tool.call({ month: '2026-03', amount: 100 });
    check(res?.success === true, 'undefined return is treated as success, not refusal');
  }

  console.log('\n[#355] holdForNextMonth: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({ month: '2026-13', amount: 100 }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on an out-of-range month');
    check(holdCalls === 0,        'no write attempted on Zod failure');

    reset();
    threw = null;
    try { await tool.call({ month: '2026-01', amount: 12.5 }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on a non-integer amount (cents only)');
    check(holdCalls === 0,        'no write attempted on Zod failure');
  }

  adapter.holdBudgetForNextMonth = originalHold;
  console.log('');
  if (failures === 0) console.log('[#355] All budgets_holdForNextMonth tests passed ✓');
  else { console.error(`[#355] ${failures} test(s) FAILED`); process.exit(2); }
})();
