// tests/unit/budgets_transfer.test.js
// Regression test for #141: actual_budgets_transfer must do exactly one
// queueWriteOperation cycle per call (down from 3) and surface adapter errors verbatim.
//
// Run via: npm run test:unit-js
// Or:      node tests/unit/budgets_transfer.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const [toolMod, adapterMod] = await Promise.all([
    import('../../dist/src/tools/budgets_transfer.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const tool    = toolMod;
  const adapter = adapterMod.default;

  // Save originals so we can restore between cases.
  const origTransfer       = adapter.transferBudgetAmount;
  const origGetBudgetMonth = adapter.getBudgetMonth;
  const origSetBudgetAmount = adapter.setBudgetAmount;

  const restore = () => {
    adapter.transferBudgetAmount = origTransfer;
    adapter.getBudgetMonth       = origGetBudgetMonth;
    adapter.setBudgetAmount      = origSetBudgetAmount;
  };

  // Schema rejection: empty input
  console.log('\n[#141] Schema rejection: empty input');
  {
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'empty input throws');
    const msg = threw?.message || '';
    check(msg.includes('month'),          'error names month');
    check(msg.includes('fromCategoryId'), 'error names fromCategoryId');
    check(msg.includes('toCategoryId'),   'error names toCategoryId');
    check(msg.includes('amount'),         'error names amount');
  }

  // Schema rejection: month format
  console.log('\n[#141] Schema rejection: month must be YYYY-MM');
  for (const badMonth of ['', '2026', 'not-a-month']) {
    let threw = null;
    try { await tool.call({ month: badMonth, fromCategoryId: 'a', toCategoryId: 'b', amount: 5000 }); } catch (e) { threw = e; }
    check(threw instanceof Error, `month "${badMonth}" rejected`);
    check((threw?.message || '').includes('month must be YYYY-MM'), `error message actionable for month "${badMonth}"`);
  }

  // Schema rejection: empty IDs
  console.log('\n[#141] Schema rejection: empty IDs');
  {
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: '', toCategoryId: 'b', amount: 5000 }); } catch (e) { threw = e; }
    check((threw?.message || '').includes('fromCategoryId is required'), 'empty fromCategoryId rejected');
  }
  {
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: '', amount: 5000 }); } catch (e) { threw = e; }
    check((threw?.message || '').includes('toCategoryId is required'), 'empty toCategoryId rejected');
  }

  // Schema rejection: amount must be positive integer
  console.log('\n[#141] Schema rejection: amount constraints');
  {
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: 0 }); } catch (e) { threw = e; }
    check((threw?.message || '').includes('amount must be positive'), 'amount=0 rejected');
  }
  {
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: -100 }); } catch (e) { threw = e; }
    check((threw?.message || '').includes('amount must be positive'), 'amount=-100 rejected');
  }
  {
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: 99.5 }); } catch (e) { threw = e; }
    check((threw?.message || '').includes('amount must be an integer'), 'amount=99.5 rejected');
  }
  {
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: '5000' }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'amount=string rejected (Zod number type)');
  }

  // Tool-layer invariant: same source and target
  console.log('\n[#141] Tool-layer: same source and target rejected before adapter');
  {
    let adapterCalled = false;
    adapter.transferBudgetAmount = async () => { adapterCalled = true; throw new Error('adapter should not be called'); };
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'cat_a', toCategoryId: 'cat_a', amount: 5000 }); } catch (e) { threw = e; }
    check(threw?.message === 'Source and target categories must be different', 'exact error message');
    check(adapterCalled === false, 'adapter NOT called when same source/target');
    restore();
  }

  // Adapter error pass-through
  console.log('\n[#141] Adapter error pass-through');
  for (const errMsg of [
    'Budget not found for month 2099-01',
    'Source category cat_x not found in budget',
    'Target category cat_y not found in budget',
    'Insufficient budget in source category. Available: 1000, Requested: 5000',
  ]) {
    adapter.transferBudgetAmount = async () => { throw new Error(errMsg); };
    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: 5000 }); } catch (e) { threw = e; }
    check(threw?.message === errMsg, `surfaces verbatim: "${errMsg.slice(0, 40)}..."`);
    restore();
  }

  // Happy path response shape
  console.log('\n[#141] Happy path: response shape');
  {
    adapter.transferBudgetAmount = async () => ({
      transferred: 5000,
      fromCategory: { id: 'a', previousAmount: 10000, newAmount: 5000 },
      toCategory:   { id: 'b', previousAmount: 0,     newAmount: 5000 },
    });
    const res = await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: 5000 });
    check(res?.result?.success === true,                          'success === true');
    check(res?.result?.transferred === 5000,                      'transferred === 5000');
    check(res?.result?.fromCategory?.id === 'a',                  'fromCategory.id');
    check(res?.result?.fromCategory?.previousAmount === 10000,    'fromCategory.previousAmount');
    check(res?.result?.fromCategory?.newAmount === 5000,          'fromCategory.newAmount');
    check(res?.result?.toCategory?.id === 'b',                    'toCategory.id');
    check(res?.result?.toCategory?.previousAmount === 0,          'toCategory.previousAmount');
    check(res?.result?.toCategory?.newAmount === 5000,            'toCategory.newAmount');
    restore();
  }

  // Lock-cycle invariant (the load-bearing regression assertion)
  console.log('\n[#141] Lock-cycle invariant: exactly one adapter call');
  {
    let transferCount = 0;
    let setBudgetAmountCount = 0;
    let getBudgetMonthCount = 0;
    adapter.transferBudgetAmount = async () => {
      transferCount++;
      return {
        transferred: 5000,
        fromCategory: { id: 'a', previousAmount: 10000, newAmount: 5000 },
        toCategory:   { id: 'b', previousAmount: 0,     newAmount: 5000 },
      };
    };
    adapter.setBudgetAmount = async () => { setBudgetAmountCount++; return {}; };
    adapter.getBudgetMonth  = async () => { getBudgetMonthCount++; return { categoryGroups: [] }; };

    const res = await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: 5000 });
    check(res?.result?.success === true,    'happy path returns success');
    check(transferCount === 1,              'transferBudgetAmount called exactly once', `was ${transferCount}`);
    check(setBudgetAmountCount === 0,       'OLD setBudgetAmount called zero times',    `was ${setBudgetAmountCount}`);
    check(getBudgetMonthCount === 0,        'OLD getBudgetMonth called zero times',     `was ${getBudgetMonthCount}`);
    restore();
  }

  // Lock-cycle invariant negative: same source/target gives zero adapter calls
  console.log('\n[#141] Lock-cycle invariant: zero adapter calls on tool-layer rejection');
  {
    let transferCount = 0;
    let setBudgetAmountCount = 0;
    let getBudgetMonthCount = 0;
    adapter.transferBudgetAmount = async () => { transferCount++; return {}; };
    adapter.setBudgetAmount      = async () => { setBudgetAmountCount++; return {}; };
    adapter.getBudgetMonth       = async () => { getBudgetMonthCount++; return {}; };

    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'cat_a', toCategoryId: 'cat_a', amount: 5000 }); } catch (e) { threw = e; }
    check(threw instanceof Error,           'tool throws same-source-target');
    check(transferCount === 0,              'transferBudgetAmount not called',    `was ${transferCount}`);
    check(setBudgetAmountCount === 0,       'setBudgetAmount not called',         `was ${setBudgetAmountCount}`);
    check(getBudgetMonthCount === 0,        'getBudgetMonth not called',          `was ${getBudgetMonthCount}`);
    restore();
  }

  // Lock-cycle invariant negative: Zod-rejected input gives zero adapter calls
  console.log('\n[#141] Lock-cycle invariant: zero adapter calls on Zod rejection');
  {
    let transferCount = 0;
    adapter.transferBudgetAmount = async () => { transferCount++; return {}; };

    let threw = null;
    try { await tool.call({ month: '2026-04', fromCategoryId: 'a', toCategoryId: 'b', amount: -1 }); } catch (e) { threw = e; }
    check(threw instanceof Error,           'Zod rejects amount=-1');
    check(transferCount === 0,              'transferBudgetAmount not called on Zod fail', `was ${transferCount}`);
    restore();
  }

  console.log('');
  if (failures === 0) {
    console.log('[#141] All budgets_transfer tests passed ✓');
  } else {
    console.error(`[#141] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
