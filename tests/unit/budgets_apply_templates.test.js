// tests/unit/budgets_apply_templates.test.js
//
// #841: actual_budgets_apply_templates and manage_budget_months action apply_templates
// (experimental feature budget_automations). Drives the REAL adapter.applyBudgetTemplates and the
// REAL tool with RAW api stubs (installed before the adapter import, session disarmed) and a test
// double for the internal-send seam. `api.internal` cannot be stubbed (a non-configurable getter),
// which is exactly why the adapter has the seam.
//
// Each guard has a negative that asserts the MESSAGE, and asserts that NOTHING WAS SENT: the
// guards run before the first send because a send cannot be undone.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/budgets_apply_templates.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
// The settle wait is bounded by half of this, so the "never settles" case takes 2 s, not 3.
process.env.ACTUAL_OP_TIMEOUT_MS  = '4000';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
const same = (actual, expected, label) => {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  a === e ? pass(label) : fail(label, `got ${a}, expected ${e}`);
};

const RENT = '70000000-0000-4000-8000-000000000001';
const FOOD = '70000000-0000-4000-8000-000000000002';
const FUN = '70000000-0000-4000-8000-000000000003';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);

// ---- the stubbed budget ----
let flagRow = 'true';                        // value of the flags.goalTemplatesEnabled row; undefined = no row
let months = ['2026-10', '2026-11', '2026-12'];
let tracking = false;
let budgeted = {};                           // id -> cents
let monthReads = 0;
let drift = false;                           // when true every read of the month differs (never settles)
const names = { [RENT]: 'Rent', [FOOD]: 'Food', [FUN]: 'Fun' };
const reset = () => {
  flagRow = 'true'; months = ['2026-10', '2026-11', '2026-12']; tracking = false; drift = false; monthReads = 0;
  budgeted = { [RENT]: 0, [FOOD]: 0, [FUN]: 500 };
  sent.length = 0; queries.length = 0; replies = defaultReplies();
};
const sent = [];
const queries = [];

apiDefault.sync = async () => {};
apiDefault.runQuery = async (query) => {
  const s = query.serialize();
  queries.push({ table: s.table, filter: s.filterExpressions });
  if (s.table === 'preferences') {
    return { data: flagRow === undefined ? [] : [{ id: s.filterExpressions[0]?.id, value: flagRow }] };
  }
  throw new Error(`unexpected query on ${s.table}`);
};
apiDefault.getBudgetMonths = async () => months;
apiDefault.getBudgetMonth = async () => {
  monthReads++;
  const rows = Object.keys(names).map((id) => ({ id, name: names[id], budgeted: budgeted[id] + (drift ? monthReads : 0) }));
  return {
    month: '2026-11',
    categoryGroups: [
      { id: 'g-income', is_income: true, categories: [], ...(tracking ? { budgeted: 0 } : {}) },
      { id: 'g-exp', is_income: false, categories: rows },
    ],
  };
};
apiDefault.getCategories = async () => Object.keys(names).map((id) => ({ id, name: names[id], group_id: 'g-exp' }));

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const errors = await import('../../dist/src/lib/errors.js');
const { isPreflightRefusal, FeatureDisabledRefusal, NotFoundRefusal, OutOfRangeRefusal, ConflictRefusal } = errors;
const { manageBudgetMonths } = await import('../../dist/src/compact/tools/manage_budget_months.js');
const tool = (await import('../../dist/src/tools/budgets_apply_templates.js')).default;

const defaultReplies = () => ({
  'budget/check-templates': { message: 'templates-check-passed' },
  'budget/apply-goal-template': () => { budgeted[RENT] = 120000; budgeted[FOOD] = 45000; return { message: 'templates-applied', count: 2 }; },
  'budget/overwrite-goal-template': () => { budgeted[RENT] = 120000; budgeted[FOOD] = 45000; budgeted[FUN] = 0; return { message: 'templates-applied', count: 3 }; },
  'budget/apply-single-template': (args) => { budgeted[args.category] = 99900; return { message: 'templates-applied', count: 1 }; },
});
let replies = defaultReplies();
adapterMod._setInternalSendForTests(async (name, args) => {
  sent.push({ name, args });
  const r = replies[name];
  if (r instanceof Error) throw r;
  return typeof r === 'function' ? r(args) : r;
});

const attempt = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const sentNames = () => sent.map((s) => s.name);

// ---------------------------------------------------------------------------
console.log('\n[#841] a month-wide apply: check first, then apply; the result is the re-read diff');
reset();
{
  const { value, error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(!error, 'no error', String(error?.message));
  same(sentNames(), ['budget/check-templates', 'budget/apply-goal-template'], 'sends the check and then the apply, once each');
  same(sent[1].args, { month: '2026-11' }, 'the apply carries only the month');
  same(value?.changes, [
    { categoryId: FOOD, name: 'Food', before: 0, after: 45000 },
    { categoryId: RENT, name: 'Rent', before: 0, after: 120000 },
  ], 'changes lists what the month now shows, sorted by name; the untouched category is absent');
  check(value?.verified === true && value?.month === '2026-11', 'verified true and the month echoed');
  check(queries.some((q) => q.table === 'preferences' && q.filter[0]?.id === 'flags.goalTemplatesEnabled'), 'the flag was read from the preferences table by its id');
}

console.log('\n[#841] overwrite true month-wide uses the overwrite handler');
reset();
{
  const { value, error } = await attempt(adapter.applyBudgetTemplates('2026-11', { overwrite: true }));
  check(!error, 'no error', String(error?.message));
  same(sentNames(), ['budget/check-templates', 'budget/overwrite-goal-template'], 'check then overwrite');
  same(sent[1].args, { month: '2026-11' }, 'month only');
  check(value?.changes.some((c) => c.categoryId === FUN && c.before === 500 && c.after === 0), 'a category reduced to zero is reported with before 500 and after 0');
}

console.log('\n[#841] one category with overwrite uses the single-template handler');
reset();
{
  const { value, error } = await attempt(adapter.applyBudgetTemplates('2026-11', { categoryId: RENT, overwrite: true }));
  check(!error, 'no error', String(error?.message));
  same(sentNames(), ['budget/check-templates', 'budget/apply-single-template'], 'check then single');
  same(sent[1].args, { month: '2026-11', category: RENT }, 'the single handler takes the category under the key "category"');
  same(value?.changes, [{ categoryId: RENT, name: 'Rent', before: 0, after: 99900 }], 'only that category changed');
}

console.log('\n[#841] a check error about ANOTHER category does not stop a single-category apply');
reset();
{
  replies['budget/check-templates'] = { message: 'template-errors', pre: 'Food: bad directive\n\nRentals: also bad' };
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11', { categoryId: RENT, overwrite: true }));
  check(!error, '"Rentals: ..." is not "Rent: ...", so it is not matched', String(error?.message));
  check(sentNames().includes('budget/apply-single-template'), 'the apply was sent');
}

// ---------------------------------------------------------------------------
console.log('\n[#841] NEGATIVE: the Goal templates flag is off');
for (const [label, value] of [['"false"', 'false'], ['no row', undefined], ['empty text', ''], ['"True"', 'True']]) {
  reset();
  flagRow = value;
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(error instanceof FeatureDisabledRefusal && isPreflightRefusal(error) && error.refusalKind === 'feature-disabled', `flag ${label}: a typed feature-disabled refusal`, String(error?.constructor?.name));
  check(error?.message === 'Goal templates are not enabled in this budget. In Actual, turn on Settings > Experimental features > Goal templates, then retry. Nothing was changed.', `flag ${label}: exact message`, error?.message);
  check(sent.length === 0, `flag ${label}: nothing was sent`);
}

console.log('\n[#841] NEGATIVE: a month this budget does not have');
reset();
{
  const { error } = await attempt(adapter.applyBudgetTemplates('2019-01'));
  check(error instanceof OutOfRangeRefusal, 'a typed out-of-range refusal');
  check(error?.message === `Month "2019-01" is outside this budget's range, which runs from 2026-10 to 2026-12. Use actual_budgets_get_months to see the months you can budget to.`, 'exact message (the same words as set_amount)', error?.message);
  check(sent.length === 0, 'nothing was sent');
}

console.log('\n[#841] NEGATIVE: a tracking budget');
reset();
tracking = true;
{
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(error instanceof ConflictRefusal && error.refusalKind === 'conflict', 'a typed conflict refusal');
  check(error?.message === 'Budget templates and cleanup need an envelope budget; this budget is a tracking budget. Nothing was changed.', 'exact message', error?.message);
  check(sent.length === 0, 'nothing was sent');
}

console.log('\n[#841] NEGATIVE: an unknown category');
reset();
{
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11', { categoryId: UNKNOWN, overwrite: true }));
  check(error instanceof NotFoundRefusal && error.refusalKind === 'not-found', 'a typed not-found refusal');
  check(error?.message.includes(UNKNOWN) && /actual_categories_get/.test(error.message), 'the message names the id and the listing tool', error?.message);
  check(sent.length === 0, 'nothing was sent');
}

console.log('\n[#841] NEGATIVE: categoryId without overwrite');
reset();
{
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11', { categoryId: RENT }));
  check(error instanceof OutOfRangeRefusal, 'a typed refusal');
  check(error?.message === "categoryId always replaces that category's budgeted amount: pass overwrite: true to confirm.", 'exact message', error?.message);
  check(sent.length === 0 && queries.length === 0, 'nothing was read or sent');
}

console.log('\n[#841] NEGATIVE: the template check finds errors (month-wide: every entry counts)');
reset();
{
  replies['budget/check-templates'] = { message: 'template-errors', pre: 'Food: bad directive\n\nFun: unknown limit' };
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(error instanceof OutOfRangeRefusal, 'a typed refusal');
  check(error?.message === 'Template check failed, nothing was changed. Fix these category notes in Actual, then retry:\nFood: bad directive\n\nFun: unknown limit', 'exact message listing both entries', error?.message);
  same(sentNames(), ['budget/check-templates'], 'only the check was sent, never the apply');
}

console.log('\n[#841] NEGATIVE: the check error belongs to the single category asked for');
reset();
{
  replies['budget/check-templates'] = { message: 'template-errors', pre: 'Rent: bad directive\n\nFood: other' };
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11', { categoryId: RENT, overwrite: true }));
  check(error instanceof OutOfRangeRefusal, 'a typed refusal');
  check(error?.message === 'Template check failed, nothing was changed. Fix these category notes in Actual, then retry:\nRent: bad directive', 'only the matching entry is listed', error?.message);
  same(sentNames(), ['budget/check-templates'], 'the apply was never sent');
}

// ---------------------------------------------------------------------------
console.log('\n[#841] a template error AFTER the apply started is a plain error, not a refusal');
reset();
{
  replies['budget/apply-goal-template'] = { message: 'template-errors', pre: 'Rent: broke mid way' };
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(error instanceof Error && !isPreflightRefusal(error), 'a plain Error: the state may have changed, so it is not a "nothing changed" refusal');
  check(error?.message === 'Actual reported template errors after the apply started; stored templates may already have been rewritten. Upstream said: Rent: broke mid way', 'exact message', error?.message);
  check(sentNames().filter((n) => n === 'budget/apply-goal-template').length === 1, 'the apply was sent once, never retried');
}

console.log('\n[#841] a send that fails is not retried and the cause survives');
reset();
{
  replies['budget/apply-goal-template'] = new Error('boom from upstream');
  const { error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(error?.message === 'boom from upstream', 'the upstream error reaches the caller', error?.message);
  check(sentNames().filter((n) => n === 'budget/apply-goal-template').length === 1, 'sent exactly once');
}

console.log('\n[#841] an unknown reply message still returns what the month shows');
reset();
{
  replies['budget/apply-goal-template'] = () => { budgeted[RENT] = 5; return { message: 'something-new' }; };
  const { value, error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(!error && value?.changes.length === 1 && value.changes[0].after === 5, 'the after-read decides the result', String(error?.message));
}

console.log('\n[#841] templates-up-to-date: nothing differs, so changes is empty and verified');
reset();
{
  replies['budget/apply-goal-template'] = { message: 'templates-up-to-date' };
  const { value } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  check(value?.verified === true && value.changes.length === 0, 'empty changes, verified true');
}

console.log('\n[#841] a month that never stops changing is reported verified:false within the bound');
reset();
{
  replies['budget/apply-goal-template'] = () => { drift = true; return { message: 'templates-applied' }; };
  const started = Date.now();
  const { value, error } = await attempt(adapter.applyBudgetTemplates('2026-11'));
  const took = Date.now() - started;
  check(!error && value?.verified === false, 'verified false, no error', String(error?.message));
  check(took < 3500, 'the wait ended inside the bound', `${took} ms`);
}

// ---------------------------------------------------------------------------
console.log('\n[#841] the tool: schema, strictness and the contract of categoryId');
reset();
{
  const ok = await attempt(tool.call({ month: '2026-11' }));
  check(!ok.error && ok.value?.result?.month === '2026-11' && Array.isArray(ok.value.result.changes), 'a valid call returns the adapter result in { result }', String(ok.error?.message));

  const noOverwrite = await attempt(tool.call({ month: '2026-11', categoryId: RENT }));
  check(/categoryId always replaces that category's budgeted amount: pass overwrite: true to confirm\./.test(noOverwrite.error?.message ?? ''), 'NEGATIVE: categoryId without overwrite names the rule', noOverwrite.error?.message);
  const falseOverwrite = await attempt(tool.call({ month: '2026-11', categoryId: RENT, overwrite: false }));
  check(/pass overwrite: true to confirm/.test(falseOverwrite.error?.message ?? ''), 'NEGATIVE: categoryId with overwrite false is refused the same way');
  const badMonth = await attempt(tool.call({ month: 'nov-2026' }));
  check(/Invalid month format \(expected YYYY-MM\)/.test(badMonth.error?.message ?? ''), 'NEGATIVE: a malformed month names the format', badMonth.error?.message);
  const extra = await attempt(tool.call({ month: '2026-11', dryRun: true }));
  check(/dryRun/.test(extra.error?.message ?? ''), 'NEGATIVE: an unknown field is refused naming it (strict schema)', extra.error?.message);
  const noMonth = await attempt(tool.call({}));
  check(/month/.test(noMonth.error?.message ?? ''), 'NEGATIVE: a missing month names the field', noMonth.error?.message);
  const badId = await attempt(tool.call({ month: '2026-11', categoryId: 'nope', overwrite: true }));
  check(/categoryId|uuid/i.test(badId.error?.message ?? ''), 'NEGATIVE: a malformed categoryId is refused', badId.error?.message);
}

console.log('\n[#841] the compact action: the same rules, in the compact key names');
{
  const row = manageBudgetMonths.actions.get('apply_templates');
  check(row?.legacy === 'actual_budgets_apply_templates', 'maps to the legacy tool');
  const parse = (v) => row.fields.safeParse(v);
  check(parse({ month: '2026-11' }).success, 'month alone is valid');
  check(parse({ month: '2026-11', category_id: RENT, overwrite: true }).success, 'category_id with overwrite true is valid');
  const noOverwrite = parse({ month: '2026-11', category_id: RENT });
  check(!noOverwrite.success && noOverwrite.error.issues.some((i) => i.message === "category_id always replaces that category's budgeted amount: pass overwrite: true to confirm."), 'NEGATIVE: category_id without overwrite, exact message', JSON.stringify(noOverwrite.error?.issues));
  const noMonth = parse({});
  check(!noMonth.success && noMonth.error.issues.some((i) => i.message === 'required for action: apply_templates'), 'NEGATIVE: a missing month is refused for the action', JSON.stringify(noMonth.error?.issues));
  const badMonth = parse({ month: '2026-13' });
  check(!badMonth.success && badMonth.error.issues.some((i) => i.message === 'month must be in YYYY-MM format (month 01 to 12)'), 'NEGATIVE: a malformed month, exact message');
  check(row.rename?.category_id === 'categoryId', 'category_id is renamed to categoryId for the legacy tool');
}

adapterMod._setInternalSendForTests();
console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
