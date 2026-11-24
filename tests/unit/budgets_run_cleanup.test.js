// tests/unit/budgets_run_cleanup.test.js
// actual_budgets_run_cleanup: runs Actual's "End of month cleanup" through the internal
// `budget/cleanup-goal-template` handler, only when goal templates are on and the budget uses
// envelope budgeting, for a month the budget has.
//
// Exercises the REAL adapter: raw api stubs before the adapter import, and
// `_setInternalSendForTests` standing in for `api.internal.send`.

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

  let prefs = {};
  let reply = { type: 'message', message: 'cleanup-applied', sourceCount: 2, sinkCount: 1 };
  let sends = [];
  apiDefault.getPreferences = async () => prefs;
  apiDefault.getBudgetMonths = async () => ['2026-09', '2026-10', '2026-11'];
  apiDefault.sync = async () => {};

  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/budgets_run_cleanup.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);
  adapterMod._setInternalSendForTests(async (name, args) => { sends.push([name, args]); return reply; });

  const ON = { 'flags.goalTemplatesEnabled': 'true' };
  const call = async (input) => {
    sends = [];
    try { return { res: await tool.call(input) }; } catch (e) { return { err: e }; }
  };

  console.log('\n[run-cleanup] applied');
  {
    prefs = ON;
    const { res, err } = await call({ month: '2026-10' });
    check(!err && JSON.stringify(res?.result) === JSON.stringify({ success: true, month: '2026-10', outcome: 'cleanup-applied', sources: 2, sinks: 1, warnings: [] }), 'returns the counts', err?.message ?? JSON.stringify(res));
    check(sends.length === 1 && sends[0][0] === 'budget/cleanup-goal-template' && JSON.stringify(sends[0][1]) === JSON.stringify({ month: '2026-10' }), 'called budget/cleanup-goal-template with { month }');
    prefs = { ...ON, budgetType: 'envelope' };
    check(!(await call({ month: '2026-10' })).err, 'an explicit envelope budget runs too');
  }
  console.log('\n[run-cleanup] warnings are a result, not an error');
  {
    prefs = ON;
    reply = { type: 'warning', message: 'cleanup-no-funds', pre: 'Dining does not have available funds.\n\nGlobal: No funds are available to reallocate.' };
    const { res } = await call({ month: '2026-10' });
    check(res?.result?.outcome === 'cleanup-no-funds' && res.result.warnings.length === 2 && res.result.warnings[1] === 'Global: No funds are available to reallocate.', 'warnings split one per line', JSON.stringify(res));
    check(res?.result?.sources === null && res?.result?.sinks === null, 'missing counters stay unknown');
    reply = { type: 'message', message: 'cleanup-up-to-date' };
    check((await call({ month: '2026-10' })).res?.result?.outcome === 'cleanup-up-to-date', 'up to date');
  }

  {
    prefs = ON;
    reply = { type: 'error', message: 'cleanup-applied-with-errors', pre: 'Invalid cleanup instruction' };
    const { res, err } = await call({ month: '2026-10' });
    check(!res && /cleanup-applied-with-errors\nInvalid cleanup instruction/.test(err?.message ?? '')
      && /Read the month before retrying/.test(err?.message ?? ''), 'cleanup errors reject and advise checking allocations', err?.message);
  }

  console.log('\n[run-cleanup] NEGATIVE: refusals, nothing sent');
  for (const [p, input, re, kind] of [
    [{}, { month: '2026-10' }, /Budget templates are turned off.*Settings > Experimental features > Goal templates/, 'feature-disabled'],
    [{ ...ON, budgetType: 'tracking' }, { month: '2026-10' }, /^End of month cleanup only works with envelope budgeting, and this budget uses tracking budgeting\. Nothing was changed\.$/, 'feature-disabled'],
    [ON, { month: '2030-01' }, /^Month "2030-01" is outside this budget's range, which runs from 2026-09 to 2026-11\./, 'out-of-range'],
  ]) {
    prefs = p;
    const { err } = await call(input);
    check(re.test(err?.message ?? ''), `refused: ${JSON.stringify(p)} ${input.month}`, err?.message);
    check(errorsMod.isPreflightRefusal(err) && err.refusalKind === kind, `a typed ${kind} refusal`);
    check(sends.length === 0, 'nothing sent');
  }
  for (const bad of [{}, { month: '2026-1' }, { month: '2026-10', extra: 1 }]) {
    prefs = ON;
    const { err } = await call(bad);
    check(err instanceof Error && sends.length === 0, `schema rejects ${JSON.stringify(bad)}`);
  }
  check(/month must be in YYYY-MM format/.test((await call({ month: '2026-1' })).err?.message ?? ''), 'bad month names the format');

  console.log('');
  if (failures === 0) console.log('[run-cleanup] All budgets_run_cleanup tests passed ✓');
  else { console.error(`[run-cleanup] ${failures} test(s) FAILED`); process.exit(2); }
})();
