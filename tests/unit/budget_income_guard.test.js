// tests/unit/budget_income_guard.test.js
// #759: income category guards and the amount bound of the budget writers, driven through the
// REAL tools and the REAL adapter with RAW api stubs (installed before the adapter import,
// session disarmed). A stubbed adapter would stub the guards away.
//
// Run via: npm run test:unit-js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'dummy';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const FOOD = '10000000-0000-4000-8000-000000000001';
const RENT = '10000000-0000-4000-8000-000000000002';
const INC  = '10000000-0000-4000-8000-0000000000a1';
const LIMIT = 2251799813685247;

const apiMod = await import('@actual-app/api');
const api = (apiMod.default || apiMod);
let writes = [];
let monthReads = 0;
let tracking = false;
let budgeted = { [FOOD]: 10000, [RENT]: 0, [INC]: 0 };
api.sync = async () => {};
api.getCategories = async () => [
  { id: FOOD, name: 'Food', is_income: false },
  { id: RENT, name: 'Rent', is_income: false },
  { id: INC, name: 'Salary', is_income: true },
];
api.getBudgetMonths = async () => ['2026-01', '2026-02', '2026-03'];
api.getBudgetMonth = async () => {
  monthReads++;
  const expense = [FOOD, RENT].map((id) => ({ id, name: id === FOOD ? 'Food' : 'Rent', is_income: false, budgeted: budgeted[id] }));
  const income = tracking ? { id: INC, name: 'Salary', is_income: true, budgeted: budgeted[INC], received: 0 } : { id: INC, name: 'Salary', is_income: true, received: 0 };
  return {
    month: '2026-02',
    categoryGroups: [
      { id: 'g-inc', is_income: true, ...(tracking ? { budgeted: 0 } : {}), categories: [income] },
      { id: 'g-exp', is_income: false, budgeted: 10000, categories: expense },
    ],
  };
};
api.setBudgetAmount = async (month, categoryId, amount) => { writes.push({ month, categoryId, amount }); budgeted[categoryId] = amount; };
api.setBudgetCarryover = async (month, categoryId, flag) => { writes.push({ month, categoryId, flag }); };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const setTool = (await import('../../dist/src/tools/budgets_set_amount.js')).default;
const transferTool = (await import('../../dist/src/tools/budgets_transfer.js')).default;
const batchTool = (await import('../../dist/src/tools/budget_updates_batch.js')).default;

const reset = (t = false) => { writes = []; monthReads = 0; tracking = t; budgeted = { [FOOD]: 10000, [RENT]: 0, [INC]: 0 }; };
const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

console.log('\n[#759] pure helpers');
{
  const mod = await import('../../dist/src/lib/actual-adapter/budget-income.js').catch(() => null);
  check(!!mod, 'budget-income helpers are built');
  if (mod) {
    check(mod.isTrackingBudgetMonth({ categoryGroups: [{ is_income: true, budgeted: 0, categories: [] }] }) === true, 'a numeric budgeted on the income group is tracking');
    check(mod.isTrackingBudgetMonth({ categoryGroups: [{ is_income: true, received: 5, categories: [] }] }) === false, 'received only is envelope');
    check(mod.isTrackingBudgetMonth({ categoryGroups: [{ is_income: false, budgeted: 5, categories: [] }] }) === false, 'an expense group budgeted does not make it tracking');
    check(mod.isTrackingBudgetMonth(null) === false && mod.isTrackingBudgetMonth({}) === false && mod.isTrackingBudgetMonth({ categoryGroups: 'x' }) === false, 'a malformed month is not tracking');
    const r = mod.incomeSetAmountRefusal({ id: INC, name: 'Salary' });
    check(isPreflightRefusal(r) && r.refusalKind === 'out-of-range' && r.value === INC, 'set_amount refusal is a typed out-of-range with the id as value');
    check(r.message.includes('"Salary"') && r.message.includes(INC) && r.message.includes('not an expense category') && r.message.endsWith('Nothing was written.'), 'set_amount refusal text names the category');
    check(mod.incomeTransferRefusal({ id: INC }).message.startsWith(`Category "${INC}" is not an expense category`), 'transfer refusal uses the id alone without a name');
  }
  const lim = await import('../../dist/src/lib/budget-limits.js').catch(() => null);
  check(lim?.MAX_BUDGET_AMOUNT_CENTS === LIMIT, 'MAX_BUDGET_AMOUNT_CENTS is 2 ** 51 - 1');
}

console.log('\n[#759] set_amount');
{
  reset();
  const res = await setTool.call({ month: '2026-02', categoryId: INC, amount: 777 });
  check(res?.success === false && /not an expense category/.test(res?.error ?? '') && (res?.error ?? '').includes('Salary'), 'income on an envelope budget is returned as { success: false, error }', JSON.stringify(res));
  check(writes.length === 0, 'and nothing is written');
  const e = await thrown(() => adapterMod.setBudgetAmount('2026-02', INC, 777));
  check(isPreflightRefusal(e) && e.refusalKind === 'out-of-range', 'the adapter throws a typed refusal');
  reset(true);
  await setTool.call({ month: '2026-02', categoryId: INC, amount: 777 });
  check(writes.length === 1 && writes[0].amount === 777, 'a tracking budget still writes an income amount once');
  reset();
  const ok = await setTool.call({ month: '2026-02', categoryId: FOOD, amount: 5000 });
  check(writes.length === 1 && ok?.success !== false, 'an expense category is unchanged');
  check(monthReads === 0, 'an expense category pays no extra month read', `reads ${monthReads}`);
  const big = await thrown(() => setTool.call({ month: '2026-02', categoryId: FOOD, amount: 9007199254740991 }));
  check(/2251799813685247/.test(big?.message ?? ''), 'an amount above the limit is refused at validation naming it', big?.message);
  const neg = await thrown(() => setTool.call({ month: '2026-02', categoryId: FOOD, amount: -LIMIT - 1 }));
  check(/2251799813685247/.test(neg?.message ?? ''), 'the negative bound is enforced');
  const edge = await thrown(() => setTool.call({ month: '2026-02', categoryId: FOOD, amount: LIMIT }));
  check(edge === null, 'the limit itself is accepted');
}

console.log('\n[#759] transfer');
{
  reset();
  let e = await thrown(() => transferTool.call({ month: '2026-02', fromCategoryId: FOOD, toCategoryId: INC, amount: 100 }));
  check(isPreflightRefusal(e) && /not an expense category/.test(e?.message ?? '') && e.message.includes('Salary'), 'a transfer into income is refused', e?.message);
  check(writes.length === 0 && budgeted[FOOD] === 10000, 'and neither category changed');
  e = await thrown(() => transferTool.call({ month: '2026-02', fromCategoryId: INC, toCategoryId: FOOD, amount: 100 }));
  check(/not an expense category/.test(e?.message ?? '') && !/Insufficient/.test(e?.message ?? ''), 'a transfer out of income is refused as such, not as insufficient funds', e?.message);
  check(writes.length === 0, 'and nothing is written');
  reset(true);
  e = await thrown(() => transferTool.call({ month: '2026-02', fromCategoryId: FOOD, toCategoryId: INC, amount: 100 }));
  check(/not an expense category/.test(e?.message ?? '') && writes.length === 0, 'it is refused on a tracking budget too');
  reset();
  budgeted[RENT] = LIMIT;
  e = await thrown(() => transferTool.call({ month: '2026-02', fromCategoryId: FOOD, toCategoryId: RENT, amount: 1 }));
  check(isPreflightRefusal(e) && (e?.message ?? '').includes('2251799813685247') && /Nothing was written/.test(e?.message ?? ''), 'a target overflow is refused naming the limit', e?.message);
  check(writes.length === 0 && budgeted[FOOD] === 10000, 'and the source is not lowered');
  reset();
  const ok = await transferTool.call({ month: '2026-02', fromCategoryId: FOOD, toCategoryId: RENT, amount: 100 });
  check(ok?.result?.success === true && writes.length === 2, 'an expense pair is unchanged');
  const big = await thrown(() => transferTool.call({ month: '2026-02', fromCategoryId: FOOD, toCategoryId: RENT, amount: LIMIT + 1 }));
  check(/2251799813685247/.test(big?.message ?? ''), 'an amount above the limit is refused at validation naming it', big?.message);
}

console.log('\n[#759] batch');
{
  reset();
  const input = { operations: [
    { month: '2026-02', categoryId: FOOD, amount: 500 },
    { month: '2026-02', categoryId: INC, amount: 700 },
    { month: '2026-03', categoryId: INC, amount: 800 },
  ] };
  const res = await batchTool.call(input);
  check(res?.successCount === 1 && res?.failureCount === 2, 'income amount items fail alone on an envelope budget', JSON.stringify(res));
  check(/not an expense category/.test(res?.failed?.[0]?.error ?? '') && res?.failed?.[0]?.index === 1, 'the failed item carries the refusal');
  check(writes.length === 1 && writes[0].categoryId === FOOD, 'only the expense item is written');
  check(monthReads === 1, 'the month is read once per call, however many income items (the memo)', `reads ${monthReads}`);
  reset(true);
  const t = await batchTool.call(input);
  check(t?.successCount === 3 && writes.length === 3, 'both items apply on a tracking budget');
  reset();
  const c = await batchTool.call({ operations: [{ month: '2026-02', categoryId: INC, carryover: true }] });
  check(c?.failureCount === 1 && /is an income category, which cannot carry over/.test(c?.failed?.[0]?.error ?? ''), 'the existing carryover refusal and text are unchanged');
  const big = await thrown(() => batchTool.call({ operations: [{ month: '2026-02', categoryId: FOOD, amount: LIMIT + 1 }] }));
  check(/2251799813685247/.test(big?.message ?? '') || /2251799813685247/.test(JSON.stringify(big?.issues ?? [])), 'an item amount above the limit is refused at validation');
}

if (failures > 0) { console.error(`\n[#759] ${failures} check(s) FAILED`); process.exit(2); }
console.log('\n[#759] All income guard tests passed');
