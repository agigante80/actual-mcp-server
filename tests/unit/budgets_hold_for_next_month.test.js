// tests/unit/budgets_hold_for_next_month.test.js
// #355: actual_budgets_holdForNextMonth must report the amount ACTUALLY held.
//
// Upstream has two ways of doing less than asked, and only one of them is a boolean:
//
//   holdForNextMonth:    if (toBudget > 0) { ...; return true; } return false;
//   calcBufferedAmount:  amount = Math.min(Math.max(amount, -buffered), Math.max(toBudget, 0));
//
// so `false` means nothing was held, and `true` can still mean a PARTIAL hold. The tool
// reads `forNextMonth` before and after and reports the observed delta.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  // A faithful fake of the upstream clamp: hold as much as toBudget allows, no more.
  let toBudget = 0;
  let buffered = 0;
  let holdCalls = 0;
  let lastArgs = null;
  let monthReads = 0;
  apiDefault.getBudgetMonth = async (month) => {
    monthReads++;
    return { month, toBudget, forNextMonth: buffered };
  };
  apiDefault.holdBudgetForNextMonth = async (month, amount) => {
    holdCalls++;
    lastArgs = [month, amount];
    if (toBudget <= 0) return false;
    const applied = Math.min(amount, Math.max(toBudget, 0));
    buffered += applied;
    return true;
  };

  // #371 moved the before/after read into adapter.holdBudgetForNextMonth, so this exercises
  // the REAL adapter method. The raw api stubs above are installed BEFORE the adapter import
  // on purpose: actual-adapter.ts destructures them at module load.
  apiDefault.sync = async () => {};
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/budgets_holdForNextMonth.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);

  const reset = (budget, startBuffered = 0) => {
    toBudget = budget; buffered = startBuffered; holdCalls = 0; lastArgs = null; monthReads = 0;
  };

  console.log('\n[#355] holdForNextMonth: positive, the full amount is held');
  {
    reset(50000);
    const batchesBefore = adapterMod._getWriteQueueBatchCountForTests();
    const res = await tool.call({ month: '2026-01', amount: 25000 });
    check(res?.success === true,       'returns success: true');
    check(res?.held === 25000,         'reports the amount held');
    check(res?.partial === undefined,  'not flagged partial');
    check(holdCalls === 1,             'raw hold called exactly once');
    check(lastArgs?.[0] === '2026-01', 'month forwarded unchanged');
    check(lastArgs?.[1] === 25000,     'amount forwarded unchanged (integer cents)');
    check(monthReads === 2,            'read before and after');
    // The #142 property asserted for real, not implied by a read count: one call must
    // dispatch exactly ONE write-queue batch.
    check(adapterMod._getWriteQueueBatchCountForTests() - batchesBefore === 1,
                          'read, write and re-read shared ONE write-queue cycle');
  }

  console.log('\n[#355] holdForNextMonth: PARTIAL hold is reported, not dressed up as success');
  {
    // Ask for 100.00 when only 30.00 is left to budget. Upstream clamps and returns true.
    reset(3000);
    const res = await tool.call({ month: '2026-01', amount: 10000 });
    check(res?.success === true,                          'still a success: something was held');
    check(res?.partial === true,                          'flagged as partial');
    check(res?.held === 3000,                             'reports what was actually held');
    check(res?.requested === 10000,                       'reports what was asked for');
    check(/clamps/i.test(res?.message ?? ''),             'explains why it was clamped');
  }

  console.log('\n[#355] holdForNextMonth: NEGATIVE, nothing could be held');
  {
    reset(0);
    let threw = null;
    try { await tool.call({ month: '2026-02', amount: 25000 }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                'throws instead of reporting success');
    check(!!threw && threw.message.includes('2026-02'),           'error names the month');
    check(!!threw && /nothing was held/i.test(threw.message),     'error says nothing was held');
    check(!!threw && /left to budget/i.test(threw.message),       'error explains why');
    check(holdCalls === 1,                                        'the write was still attempted');
  }

  console.log('\n[#355] holdForNextMonth: NEGATIVE, a negative To Budget holds nothing');
  {
    reset(-500);
    let threw = null;
    try { await tool.call({ month: '2026-03', amount: 100 }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws when To Budget is negative');
  }

  console.log('\n[#355] holdForNextMonth: an existing hold is added to, not replaced');
  {
    reset(50000, 1000);
    const res = await tool.call({ month: '2026-01', amount: 2000 });
    check(res?.held === 2000, 'reports the DELTA, not the running total');
  }

  console.log('\n[#355] holdForNextMonth: schema');
  {
    for (const bad of [{ month: '2026-13', amount: 100 }, { month: '2026-01', amount: 12.5 },
                       { month: '2026-01', amount: 0 }, { month: '2026-01', amount: -1 }]) {
      reset(50000);
      let threw = null;
      try { await tool.call(bad); } catch (e) { threw = e; }
      check(threw instanceof Error, `rejects ${JSON.stringify(bad)}`);
      check(holdCalls === 0,        'no write attempted on Zod failure');
      check(monthReads === 0,       'the adapter was never reached on a Zod failure');
    }
  }

  console.log('');
  if (failures === 0) console.log('[#355] All budgets_holdForNextMonth tests passed ✓');
  else { console.error(`[#355] ${failures} test(s) FAILED`); process.exit(2); }
})();
