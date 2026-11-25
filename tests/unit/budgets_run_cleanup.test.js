// tests/unit/budgets_run_cleanup.test.js
//
// #841: actual_budgets_run_cleanup and manage_budget_months action run_cleanup (experimental
// feature budget_automations). Same harness as budgets_apply_templates.test.js: RAW api stubs
// before the adapter import, session disarmed, a test double for the internal-send seam.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/budgets_run_cleanup.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
process.env.ACTUAL_OP_TIMEOUT_MS  = '4000';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
const same = (actual, expected, label) => {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  a === e ? pass(label) : fail(label, `got ${a}, expected ${e}`);
};

const RENT = '71000000-0000-4000-8000-000000000001';
const SAVE = '71000000-0000-4000-8000-000000000002';
const names = { [RENT]: 'Rent', [SAVE]: 'Savings' };

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);

let flagRow = 'true';
let months = ['2026-10', '2026-11', '2026-12'];
let tracking = false;
let budgeted = {};
let drift = false;
let monthReads = 0;
const sent = [];
const queries = [];
let replies = {};
const reset = () => {
  flagRow = 'true'; months = ['2026-10', '2026-11', '2026-12']; tracking = false; drift = false; monthReads = 0;
  budgeted = { [RENT]: 30000, [SAVE]: 0 };
  sent.length = 0; queries.length = 0;
  replies = { 'budget/cleanup-goal-template': () => { budgeted[RENT] = 0; budgeted[SAVE] = 30000; return { message: 'cleanup-applied' }; } };
};

apiDefault.sync = async () => {};
apiDefault.runQuery = async (query) => {
  const s = query.serialize();
  queries.push(s.table);
  if (s.table === 'preferences') return { data: flagRow === undefined ? [] : [{ id: s.filterExpressions[0]?.id, value: flagRow }] };
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

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { isPreflightRefusal, FeatureDisabledRefusal, OutOfRangeRefusal, ConflictRefusal } = await import('../../dist/src/lib/errors.js');
const { categorizeError } = await import('../../dist/src/lib/processHandlers.js');
const { manageBudgetMonths } = await import('../../dist/src/compact/tools/manage_budget_months.js');
const tool = (await import('../../dist/src/tools/budgets_run_cleanup.js')).default;

adapterMod._setInternalSendForTests(async (name, args) => {
  sent.push({ name, args });
  const r = replies[name];
  if (r instanceof Error) throw r;
  return typeof r === 'function' ? r(args) : r;
});

const attempt = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const sentNames = () => sent.map((s) => s.name);

console.log('\n[#841] cleanup: one send, the result is the re-read diff');
reset();
{
  const { value, error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(!error, 'no error', String(error?.message));
  same(sentNames(), ['budget/cleanup-goal-template'], 'exactly one send, no template check first');
  same(sent[0]?.args, { month: '2026-11' }, 'the handler carries only the month');
  same(value?.changes, [
    { categoryId: RENT, name: 'Rent', before: 30000, after: 0 },
    { categoryId: SAVE, name: 'Savings', before: 0, after: 30000 },
  ], 'changes shows the money that moved, sorted by name');
  check(value?.verified === true && value?.notice === undefined, 'verified true and no notice');
}

console.log('\n[#841] cleanup-up-to-date: nothing moved');
reset();
{
  replies['budget/cleanup-goal-template'] = { message: 'cleanup-up-to-date' };
  const { value } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(value?.changes.length === 0 && value.verified === true && value.notice === undefined, 'empty changes, verified, no notice');
}

console.log('\n[#841] cleanup-no-funds: a notice, not an error');
reset();
{
  replies['budget/cleanup-goal-template'] = { message: 'cleanup-no-funds', pre: 'There is no money available to move.' };
  const { value, error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(!error, 'no error', String(error?.message));
  check(value?.notice === 'There is no money available to move.', 'the notice carries the upstream text', value?.notice);
  check(value?.changes.length === 0 && value.verified === true, 'changes empty and verified');
}

console.log('\n[#841] cleanup-applied-with-errors: the partial move is returned with a notice');
reset();
{
  replies['budget/cleanup-goal-template'] = () => { budgeted[RENT] = 10000; budgeted[SAVE] = 20000; return { message: 'cleanup-applied-with-errors', pre: 'Group "Bills" has no sink.' }; };
  const { value, error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(!error, 'no error', String(error?.message));
  check(value?.notice === 'Group "Bills" has no sink.', 'notice is the upstream text', value?.notice);
  same(value?.changes.map((c) => [c.categoryId, c.after]), [[RENT, 10000], [SAVE, 20000]], 'what did move is reported');
}

console.log('\n[#841] a notice without upstream text falls back to the reply name');
reset();
{
  replies['budget/cleanup-goal-template'] = { message: 'cleanup-no-funds' };
  const { value } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(value?.notice === 'cleanup-no-funds', 'notice is the reply name', value?.notice);
}

console.log('\n[#841] template-errors during cleanup is a plain error (money may have moved)');
reset();
{
  replies['budget/cleanup-goal-template'] = { message: 'template-errors', pre: 'Rent: bad cleanup directive' };
  const { error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(error instanceof Error && !isPreflightRefusal(error), 'a plain Error, not a refusal');
  check(error?.message === 'Actual reported template errors during the cleanup; some money may already have moved. Upstream said: Rent: bad cleanup directive', 'exact message', error?.message);
  check(error?.upstreamReported === true, 'typed as upstream-reported, so the pool-drop classifier never reads its text');
}

console.log('\n[#841] a failing send is sent once and surfaces its cause');
reset();
{
  replies['budget/cleanup-goal-template'] = new Error('boom from upstream');
  const { error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(error?.message === 'boom from upstream', 'the upstream error reaches the caller', error?.message);
  check(sent.length === 1, 'never retried', String(sent.length));
}

console.log('\n[#841] a month that never settles is verified:false');
reset();
{
  replies['budget/cleanup-goal-template'] = () => { drift = true; return { message: 'cleanup-applied' }; };
  const { value, error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(!error && value?.verified === false, 'verified false, no error', String(error?.message));
}

console.log('\n[#841] NEGATIVE: the Goal templates flag is off');
for (const [label, value] of [['"false"', 'false'], ['no row', undefined]]) {
  reset();
  flagRow = value;
  const { error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(error instanceof FeatureDisabledRefusal && error.refusalKind === 'feature-disabled', `flag ${label}: typed feature-disabled refusal`);
  check(error?.message === 'Goal templates are not enabled in this budget. In Actual, turn on Settings > Experimental features > Goal templates, then retry. Nothing was changed.', `flag ${label}: exact message`, error?.message);
  check(sent.length === 0, `flag ${label}: nothing was sent`);
}

console.log('\n[#841] NEGATIVE: out-of-range month');
reset();
{
  const { error } = await attempt(adapter.runBudgetCleanup('2019-01'));
  check(error instanceof OutOfRangeRefusal, 'typed out-of-range refusal');
  check(error?.message === `Month "2019-01" is outside this budget's range, which runs from 2026-10 to 2026-12. Use actual_budgets_get_months to see the months you can budget to.`, 'exact message', error?.message);
  check(sent.length === 0, 'nothing was sent');
}

console.log('\n[#841] NEGATIVE: tracking budget');
reset();
tracking = true;
{
  const { error } = await attempt(adapter.runBudgetCleanup('2026-11'));
  check(error instanceof ConflictRefusal, 'typed conflict refusal');
  check(error?.message === 'Budget templates and cleanup need an envelope budget; this budget is a tracking budget. Nothing was changed.', 'exact message', error?.message);
  check(sent.length === 0, 'nothing was sent');
}

console.log('\n[#841] feature-disabled is classified as a conflict, not a server fault');
{
  check(categorizeError(new FeatureDisabledRefusal('x')) === 'conflict', 'categorizeError maps feature-disabled to conflict');
  check(isPreflightRefusal(new FeatureDisabledRefusal('x')), 'isPreflightRefusal recognises it');
}

console.log('\n[#841] the tool: schema and strictness');
reset();
{
  const ok = await attempt(tool.call({ month: '2026-11' }));
  check(!ok.error && ok.value?.result?.month === '2026-11', 'valid call returns { result }', String(ok.error?.message));
  const extra = await attempt(tool.call({ month: '2026-11', categoryId: RENT }));
  check(/categoryId/.test(extra.error?.message ?? ''), 'NEGATIVE: an unknown field is refused naming it', extra.error?.message);
  const noMonth = await attempt(tool.call({}));
  check(/month/.test(noMonth.error?.message ?? ''), 'NEGATIVE: missing month names the field', noMonth.error?.message);
  const bad = await attempt(tool.call({ month: 'nov-2026' }));
  check(/Invalid month format \(expected YYYY-MM\)/.test(bad.error?.message ?? ''), 'NEGATIVE: malformed month names the format', bad.error?.message);
}

console.log('\n[#841] the compact action');
{
  const row = manageBudgetMonths.actions.get('run_cleanup');
  check(row?.legacy === 'actual_budgets_run_cleanup', 'maps to the legacy tool');
  check(row.fields.safeParse({ month: '2026-11' }).success, 'month alone is valid');
  const noMonth = row.fields.safeParse({});
  check(!noMonth.success && noMonth.error.issues.some((i) => i.message === 'required for action: run_cleanup'), 'NEGATIVE: missing month, exact message', JSON.stringify(noMonth.error?.issues));
  const extra = row.fields.strict().safeParse({ month: '2026-11', category_id: RENT });
  check(!extra.success, 'NEGATIVE: category_id is not a run_cleanup field', JSON.stringify(extra.error?.issues));
}

adapterMod._setInternalSendForTests();
console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
