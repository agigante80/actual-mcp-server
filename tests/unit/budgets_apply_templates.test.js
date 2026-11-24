// tests/unit/budgets_apply_templates.test.js
// actual_budgets_apply_templates: applies Actual's goal templates for a month (or one category)
// through the internal `budget/apply-goal-template` / `budget/apply-single-template` handlers,
// and only when the budget's `flags.goalTemplatesEnabled` synced preference is 'true'.
//
// Exercises the REAL adapter: the raw api stubs are installed before the adapter import, and
// `_setInternalSendForTests` stands in for `api.internal.send` (a non-configurable getter).

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const CAT = '10000000-0000-4000-8000-000000000001';
const MISSING = '10000000-0000-4000-8000-000000000099';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let prefs = {};
  let reply = { type: 'message', message: 'templates-applied', count: 2 };
  let sends = [];
  let goalRows = [];
  let budgeted = 0;
  let witness;
  apiDefault.getPreferences = async () => { witness?.noteRead(); return prefs; };
  apiDefault.getCategories = async () => [{ id: CAT, name: 'Groceries' }];
  apiDefault.getBudgetMonths = async () => ['2026-01', '2026-02', '2026-03'];
  apiDefault.getBudgetMonth = async () => ({ categoryGroups: [{ categories: [{ id: CAT, budgeted }] }] });
  apiDefault.getCategoryGroups = async () => [{ categories: [{ id: CAT }] }];
  apiDefault.runQuery = async () => ({ data: goalRows });
  apiDefault.sync = async () => {};

  const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/budgets_apply_templates.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);
  adapterMod._setInternalSendForTests(async (name, args) => {
    witness?.noteWrite();
    if (name === 'budget/store-note-templates') return;
    sends.push([name, args]);
    return reply;
  });
  witness = makeCycleWitness(adapterMod);

  const reset = (p, r = { type: 'message', message: 'templates-applied', count: 2 }) => {
    prefs = p; reply = r; sends = []; goalRows = []; budgeted = 0; witness.reset();
  };
  const call = async (input) => {
    try { return { res: await tool.call(input) }; } catch (e) { return { err: e }; }
  };
  const ON = { 'flags.goalTemplatesEnabled': 'true' };

  console.log('\n[apply-templates] feature flag OFF: refused, nothing sent');
  for (const p of [{}, { 'flags.goalTemplatesEnabled': 'false' }, null]) {
    reset(p);
    const { err } = await call({ month: '2026-02' });
    check(err instanceof Error, `refused with prefs ${JSON.stringify(p)}`);
    check(/turned off/.test(err?.message ?? '') && /Settings > Experimental features/.test(err?.message ?? ''),
      'error says templates are off and where to enable them', err?.message);
    check(sends.length === 0, 'no template handler was called');
    check(errorsMod.isPreflightRefusal(err) && err.refusalKind === 'feature-disabled', 'a typed feature-disabled refusal', err?.name);
  }

  console.log('\n[apply-templates] flag ON, whole month');
  {
    reset(ON);
    const { res, err } = await call({ month: '2026-02' });
    check(!err, 'no error', err?.message);
    check(res?.result?.success === true && res.result.month === '2026-02' && res.result.applied === 2,
      'returns { success, month, applied }', JSON.stringify(res));
    check(sends.length === 1 && sends[0][0] === 'budget/apply-goal-template', 'called budget/apply-goal-template');
    check(JSON.stringify(sends[0]?.[1]) === JSON.stringify({ month: '2026-02' }), 'forwarded { month }');
    check(witness.sharedOneCycle(), 'flag read and apply shared ONE write-queue cycle', witness.describe());
  }

  console.log('\n[apply-templates] flag ON, overwrite');
  {
    reset(ON, { type: 'message', message: 'templates-applied', count: 5 });
    const { res, err } = await call({ month: '2026-02', overwrite: true });
    check(!err && res?.result?.applied === 5, 'applied: 5', err?.message);
    check(sends[0]?.[0] === 'budget/overwrite-goal-template', 'called budget/overwrite-goal-template');
    check(JSON.stringify(sends[0]?.[1]) === JSON.stringify({ month: '2026-02' }), 'forwarded { month }');
    reset(ON);
    await call({ month: '2026-02', overwrite: false });
    check(sends[0]?.[0] === 'budget/apply-goal-template', 'overwrite: false keeps the plain apply');
    reset(ON);
    await call({ month: '2026-03', categoryId: CAT, overwrite: true });
    check(sends[0]?.[0] === 'budget/apply-single-template', 'categoryId still applies that one category');
  }

  console.log('\n[apply-templates] flag ON, nothing to apply');
  {
    reset(ON, { type: 'message', message: 'templates-up-to-date' });
    const { res } = await call({ month: '2026-02' });
    check(res?.result?.success === true && res.result.applied === 0, 'applied: 0 when up to date');
  }

  console.log('\n[apply-templates] flag ON, single category');
  {
    reset(ON, { type: 'message', message: 'templates-applied', count: 1 });
    const { res, err } = await call({ month: '2026-03', categoryId: CAT });
    check(!err && res?.result?.applied === 1, 'applied: 1', err?.message);
    check(sends[0]?.[0] === 'budget/apply-single-template', 'called budget/apply-single-template');
    check(JSON.stringify(sends[0]?.[1]) === JSON.stringify({ month: '2026-03', category: CAT }), 'forwarded { month, category }');
  }

  console.log('\n[apply-templates] NEGATIVE: unknown category');
  {
    reset(ON);
    const { err } = await call({ month: '2026-03', categoryId: MISSING });
    check(err?.message === `Category "${MISSING}" not found. Use actual_categories_get to list available categories.`,
      'not-found message names the id and the list tool', err?.message);
    check(sends.length === 0, 'no template handler was called');
  }

  console.log('\n[apply-templates] NEGATIVE: month outside the budget');
  {
    reset(ON);
    const { err } = await call({ month: '2030-01' });
    check(/Month "2030-01" is outside this budget's range, which runs from 2026-01 to 2026-03/.test(err?.message ?? ''),
      'out-of-range message names the range', err?.message);
    check(sends.length === 0, 'no template handler was called');
  }

  console.log('\n[apply-templates] NEGATIVE: template syntax errors');
  {
    reset(ON);
    goalRows = [{ name: 'Groceries', goal_def: JSON.stringify([{ type: 'error', line: '#template unparseable' }]) }];
    const { err } = await call({ month: '2026-02', categoryId: CAT });
    check(/Groceries.*#template unparseable/.test(err?.message ?? '') && sends.length === 0, 'does not overwrite a category with a malformed note', err?.message);
    const all = await call({ month: '2026-02' });
    check(/Groceries.*#template unparseable/.test(all.err?.message ?? '') && sends.length === 0, 'whole month also refuses a malformed note it would apply');
    budgeted = 2000;
    check(!(await call({ month: '2026-02' })).err, 'normal apply skips funded categories');
    reset(ON);
    const conflict = await call({ month: '2026-02', categoryId: CAT, overwrite: false });
    check(/single category always overwrites/i.test(conflict.err?.message ?? '') && sends.length === 0, 'explicit overwrite false is refused for one category');
  }
  {
    reset(ON, { sticky: true, message: 'template-errors', pre: 'Groceries: Expected number' });
    const { err } = await call({ month: '2026-02' });
    check(/No budget templates were applied for 2026-02/.test(err?.message ?? '') && /Groceries: Expected number/.test(err?.message ?? ''),
      'error says nothing was applied and carries upstream\'s template errors', err?.message);
  }

  console.log('\n[apply-templates] NEGATIVE: schema');
  for (const bad of [{}, { month: '2026-13' }, { month: '2026-02', categoryId: 'nope' }, { month: '2026-02', extra: 1 }]) {
    reset(ON);
    const { err } = await call(bad);
    check(err instanceof Error, `rejects ${JSON.stringify(bad)}`);
    check(sends.length === 0, 'adapter never reached');
  }
  {
    const { err } = await call({ month: '2026-1' });
    check(/month must be in YYYY-MM format/.test(err?.message ?? ''), 'bad month names the format', err?.message);
  }

  console.log('');
  if (failures === 0) console.log('[apply-templates] All budgets_apply_templates tests passed ✓');
  else { console.error(`[apply-templates] ${failures} test(s) FAILED`); process.exit(2); }
})();
