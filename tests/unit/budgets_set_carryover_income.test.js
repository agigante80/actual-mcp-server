// tests/unit/budgets_set_carryover_income.test.js
// #771: set_carryover on an income category is a typed ConflictRefusal in the caller's words,
// not upstream's `budget-set-carryover: category "<id>" is not an expense category`. The REAL
// adapter runs against RAW api stubs (installed before the adapter import).
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
const INC  = '10000000-0000-4000-8000-0000000000a1';
const NONE = '10000000-0000-4000-8000-0000000000ff';

const apiMod = await import('@actual-app/api');
const api = (apiMod.default || apiMod);
let writes = [];
api.sync = async () => {};
api.getCategories = async () => [
  { id: FOOD, name: 'Food', is_income: false },
  { id: INC, name: 'Salary', is_income: true },
];
api.setBudgetCarryover = async (month, categoryId, flag) => { writes.push({ month, categoryId, flag }); };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const { isPreflightRefusal, ConflictRefusal, NotFoundRefusal } = await import('../../dist/src/lib/errors.js');
const adapter = adapterMod.default;
const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

console.log('\n[#771] carryover on an income category is refused before any write');
{
  writes = [];
  const err = await thrown(() => adapter.setBudgetCarryover('2027-06', INC, true));
  check(err instanceof ConflictRefusal && isPreflightRefusal(err), 'a ConflictRefusal', String(err));
  check(/income category/.test(err?.message ?? '') && /Salary/.test(err?.message ?? ''), 'it names the category and says income', err?.message);
  check(!/budget-set-carryover/.test(err?.message ?? ''), 'it carries no upstream handler name', err?.message);
  check(writes.length === 0, 'no raw write was attempted');
}

console.log('\n[#771] an expense category still writes');
{
  writes = [];
  await adapter.setBudgetCarryover('2027-06', FOOD, true);
  check(writes.length === 1 && writes[0].categoryId === FOOD && writes[0].flag === true, 'the raw write ran once with the arguments given', JSON.stringify(writes));
}

console.log('\n[#771] NEGATIVE: an unknown category is a NotFoundRefusal naming the lookup tool');
{
  writes = [];
  const err = await thrown(() => adapter.setBudgetCarryover('2027-06', NONE, false));
  check(err instanceof NotFoundRefusal && isPreflightRefusal(err), 'a NotFoundRefusal', String(err));
  check(/actual_categories_get/.test(err?.message ?? ''), 'it names where to look', err?.message);
  check(writes.length === 0, 'no raw write was attempted');
}

if (failures > 0) { console.error(`\n[carryover-income] ${failures} test(s) FAILED`); process.exit(1); }
console.log('\n[carryover-income] All tests passed');
