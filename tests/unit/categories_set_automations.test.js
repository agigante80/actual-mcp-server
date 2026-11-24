// tests/unit/categories_set_automations.test.js
// actual_categories_set_automations: adds to a category's automations through the internal
// `budget/set-category-automations` handler with source 'ui', as Actual's automation editor saves
// them, filling the editor's defaults. Like the editor, a category still on note templates has them
// imported first; a 'ui' category keeps its saved automations; replace drops them. Refused unless goal templates AND the Budget automations UI
// sub-toggle are on.
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

const CAT = '10000000-0000-4000-8000-000000000001';
const INCOME = '10000000-0000-4000-8000-000000000002';
const MISSING = '10000000-0000-4000-8000-000000000099';
const SCHED = '20000000-0000-4000-8000-000000000001';
const SAME_NAME = '10000000-0000-4000-8000-000000000003'; // an expense category also named Salary

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let prefs = {};
  let sends = [];
  let source = 'notes';       // the category's template_settings.source
  let existing = [];          // what budget/get-category-automations answers for it
  apiDefault.getPreferences = async () => prefs;
  apiDefault.getCategories = async () => [{ id: CAT, name: 'Groceries' }, { id: SAME_NAME, name: 'Salary' }, { id: INCOME, name: 'Salary', is_income: true }];
  apiDefault.getSchedules = async () => [{ id: SCHED, name: 'Rent' }];
  apiDefault.runQuery = async () => ({ data: [{ id: CAT, template_settings: { source } }] });
  apiDefault.sync = async () => {};

  const [tool, adapterMod, errorsMod, { toTemplate, importNoteTemplates }] = await Promise.all([
    import('../../dist/src/tools/categories_set_automations.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
    import('../../dist/src/lib/schemas/automations.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);
  adapterMod._setInternalSendForTests(async (name, args) => {
    sends.push([name, args]);
    if (name === 'budget/create-cleanup-group') return { id: `pool-${args.name.toLowerCase()}` };
    return name === 'budget/get-category-automations' ? { [args]: existing } : undefined;
  });

  const ON = { 'flags.goalTemplatesEnabled': 'true', 'flags.goalTemplatesUIEnabled': 'true' };
  const call = async (input) => {
    sends = [];
    try { return { res: await tool.call(input) }; } catch (e) { return { err: e }; }
  };
  const setCall = () => sends.find(([n]) => n === 'budget/set-category-automations');
  const saved = () => setCall()?.[1]?.categoriesWithTemplates?.[0]?.templates;
  const names = () => sends.map(([n]) => n.replace('budget/', ''));

  console.log('\n[set-automations] defaults match the automation editor');
  {
    const now = new Date(2026, 10, 22); // 2026-11-22
    const t = (a) => JSON.stringify(toTemplate(a, now));
    check(t({ type: 'fixed' }) === JSON.stringify({ directive: 'template', priority: 1, type: 'periodic', amount: 100, period: { period: 'month', amount: 1 }, starting: '2026-11-01' }), 'fixed: $100 monthly from the 1st, priority 1', t({ type: 'fixed' }));
    check(t({ type: 'by' }) === JSON.stringify({ directive: 'template', priority: 1, type: 'by', amount: 1200, month: '2027-11', annual: true, repeat: 1 }), 'by: $1,200 by 12 months out, yearly', t({ type: 'by' }));
    check(t({ type: 'percentage' }) === JSON.stringify({ directive: 'template', priority: 1, type: 'percentage', percent: 15, previous: false, category: 'all income' }), 'percentage: 15% of all income');
    check(t({ type: 'average' }).includes('"numMonths":3') && t({ type: 'copy' }).includes('"lookBack":3'), 'average and copy: 3 months');
    check(t({ type: 'remainder' }) === JSON.stringify({ directive: 'template', type: 'remainder', weight: 1, priority: null }), 'remainder: weight 1, no priority');
    check(t({ type: 'limit' }) === JSON.stringify({ directive: 'template', type: 'limit', amount: 500, period: 'monthly', hold: false, priority: null }), 'limit: $500 monthly');
    check(t({ type: 'goal' }) === JSON.stringify({ directive: 'goal', type: 'goal', amount: 1000 }), 'goal: $1,000');
    check(t({ type: 'fixed', amount: 25050, priority: 3 }).includes('"amount":250.5') && t({ type: 'fixed', priority: 3 }).includes('"priority":3'), 'cents become currency units; priority kept');
  }

  console.log('\n[set-automations] flags ON: saved through the editor handler');
  {
    prefs = ON;
    const { res, err } = await call({ categoryId: CAT, automations: [{ type: 'fixed', amount: 25000 }, { type: 'schedule', scheduleId: SCHED }, { type: 'percentage', incomeCategory: INCOME, percent: 10 }] });
    check(!err && res?.result?.success === true && res.result.count === 3 && res.result.categoryId === CAT, 'returns { success, categoryId, count }', err?.message ?? JSON.stringify(res));
    check(!!setCall(), 'called budget/set-category-automations');
    check(setCall()?.[1]?.source === 'ui' && setCall()[1].categoriesWithTemplates[0].id === CAT, "source 'ui' for that category");
    check(saved()?.[0]?.amount === 250 && saved()?.[1]?.name === 'Rent' && saved()?.[1]?.scheduleId === SCHED, 'amount in units, schedule name filled in');
    check(!('cleanup' in setCall()[1].categoriesWithTemplates[0]), 'cleanup is left untouched');
  }

  console.log('\n[set-automations] a category on note templates: imported first, as the editor does');
  {
    source = 'notes';
    existing = [{ type: 'percentage', percent: 5, category: 'Salary', previous: false, directive: 'template', priority: 0 }];
    await call({ categoryId: CAT, automations: [] });
    check(saved()?.[0]?.category === INCOME, 'a percentage name resolves to the income category, not an expense one with the same name', JSON.stringify(saved()));
    existing = [{ type: 'simple', monthly: 50, directive: 'template', priority: 0 }];
    const { res, err } = await call({ categoryId: CAT, automations: [{ type: 'remainder' }] });
    check(!err && res?.result?.imported === 1 && res.result.count === 2, 'imported 1, count 2', err?.message ?? JSON.stringify(res));
    check(JSON.stringify(names()) === JSON.stringify(['store-note-templates', 'get-category-automations', 'store-note-cleanups', 'set-category-automations']), 'refreshes the note templates, reads them, refreshes the note cleanup, then saves', JSON.stringify(names()));
    check(JSON.stringify(sends[0][1]) === JSON.stringify([CAT]) && sends[1][1] === CAT && JSON.stringify(sends[2][1]) === JSON.stringify([CAT]), 'scoped to that category');
    check(saved()?.[0]?.type === 'periodic' && saved()[0].amount === 50 && saved()[0].priority === 0 && saved()[1]?.type === 'remainder', 'note template first (as a fixed amount, its priority kept), then the new one', JSON.stringify(saved()));
  }
  console.log('\n[set-automations] a ui category keeps its saved automations, untransformed');
  {
    source = 'ui';
    existing = [{ type: 'simple', monthly: 7, directive: 'template', priority: 1 }];
    const { res } = await call({ categoryId: CAT, automations: [{ type: 'fixed' }] });
    check(res?.result?.imported === 0 && res.result.count === 2, 'imported 0, count 2', JSON.stringify(res));
    check(!names().includes('store-note-templates') && !names().includes('store-note-cleanups'), 'notes are not re-read');
    check(saved()?.[0]?.type === 'simple' && saved()[1]?.type === 'periodic', 'saved list kept as is, new one after');
  }
  console.log('\n[set-automations] replace drops what is there');
  {
    source = 'ui';
    existing = [{ type: 'refill', directive: 'template', priority: 1 }];
    const { res } = await call({ categoryId: CAT, automations: [], replace: true });
    check(res?.result?.count === 0 && saved()?.length === 0 && !names().includes('get-category-automations'), 'replace with [] clears, without reading');
    source = 'notes';
    const r2 = await call({ categoryId: CAT, automations: [{ type: 'fixed' }], replace: true });
    check(r2.res?.result?.imported === 0 && saved()?.length === 1, 'replace on a notes category imports nothing');
    check(names()[0] === 'store-note-templates' && names().includes('store-note-cleanups'), 'but still refreshes the note cleanup it keeps');
    existing = [{ type: 'error', directive: 'error', line: '#template banana', error: 'Expected number' }];
    const r3 = await call({ categoryId: CAT, automations: [{ type: 'refill' }], replace: true });
    check(/cannot read: #template banana/.test(r3.err?.message ?? '') && !setCall(), 'replace on a notes category with an unreadable note is refused too, nothing saved', r3.err?.message);
    existing = [];
  }
  console.log('\n[set-automations] NEGATIVE: a note template Actual cannot read');
  {
    source = 'notes';
    existing = [{ type: 'error', directive: 'error', line: '#template banana', error: 'Expected number' }];
    const { err } = await call({ categoryId: CAT, automations: [{ type: 'refill' }] });
    check(err?.message === `Category "${CAT}" has a note template Actual cannot read: #template banana. Fix or remove that line in the category note, then try again. No automations were saved.`, 'refused, quoting the line', err?.message);
    check(errorsMod.isPreflightRefusal(err) && err.refusalKind === 'conflict', 'a typed conflict refusal');
    check(!setCall(), 'nothing saved');
    check(!names().includes('store-note-cleanups'), 'and the note cleanup is not refreshed (no pool revived) before the refusal');
    existing = [];
  }

  console.log('\n[set-automations] cleanup, as #cleanup lines saved the editor way');
  {
    source = 'ui'; existing = [];
    const weekly = await call({ categoryId: CAT, automations: [{ type: 'fixed', starting: '2026-11-03' }, { type: 'limit', limitPeriod: 'weekly' }] });
    check(!weekly.err && saved()?.[1]?.start === '2026-11-03', 'weekly cap defaults to the earliest contributor start', weekly.err?.message);
    const explicit = await call({ categoryId: CAT, automations: [{ type: 'refill' }, { type: 'limit', limitPeriod: 'weekly', starting: '2026-11-02' }] });
    check(!explicit.err && saved()?.[1]?.start === '2026-11-02', 'weekly cap accepts an explicit start', explicit.err?.message);
    for (const [automations, message] of [
      [[{ type: 'fixed' }, { type: 'limit' }, { type: 'limit' }], /Only one.*limit/],
      [[{ type: 'goal' }, { type: 'goal' }], /Only one.*goal/],
      [[{ type: 'schedule', scheduleId: SCHED, priority: 2 }, { type: 'by' }], /same priority/],
      [[{ type: 'percentage', percent: 70 }, { type: 'percentage', percent: 50 }], /100%/],
      [[{ type: 'percentage', percent: 150 }], /100/],
      [[{ type: 'refill' }, { type: 'limit', limitPeriod: 'weekly', starting: '2026-02-30' }], /valid calendar date/],
      [[{ type: 'refill' }], /refill.*limit/i],
      [[{ type: 'limit' }], /limit.*contributing/i],
    ]) {
      const { err } = await call({ categoryId: CAT, automations, cleanup: ['New pool source'] });
      check(message.test(err?.message ?? '') && !setCall() && !names().includes('create-cleanup-group'), `rejects ${message} before saving or creating a pool`, err?.message);
    }
    source = 'notes';
    existing = [{ type: 'schedule', name: 'Missing Rent', directive: 'template', priority: 0 }];
    const { err } = await call({ categoryId: CAT, automations: [{ type: 'fixed' }] });
    check(/Schedule.*Missing Rent.*not found/.test(err?.message ?? '') && !setCall() && !names().includes('store-note-cleanups'), 'refuses an unresolved imported schedule before refreshing cleanup', err?.message);
    existing = [];
  }
  {
    source = 'ui'; existing = [];
    const { res, err } = await call({ categoryId: CAT, cleanup: ['source', 'sink 3', 'Fun source', 'Bills', 'Gifts sink', 'Big Pool sink 0'] });
    check(!err && res?.result?.cleanup === 6 && res.result.count === 0, 'cleanup only: 6 rows, no automations', err?.message ?? JSON.stringify(res));
    const def = setCall()?.[1]?.categoriesWithTemplates?.[0]?.cleanup;
    check(JSON.stringify(def) === JSON.stringify([
      { role: 'source', groupId: null },
      { role: 'sink', groupId: null, weight: 3 },
      { role: 'source', groupId: 'pool-fun' },
      { role: 'overspend', groupId: 'pool-bills' },
      { role: 'sink', groupId: 'pool-gifts', weight: 1 },
      { role: 'sink', groupId: 'pool-big pool', weight: 1 },
    ]), 'parsed like upstream #cleanup notes: global and pool source/sink, bare pool is overspend, weight 0 or none is 1', JSON.stringify(def));
    check(JSON.stringify(sends.filter(([n]) => n === 'budget/create-cleanup-group').map(([, a]) => a.name)) === JSON.stringify(['Fun', 'Bills', 'Gifts', 'Big Pool']), 'each pool created by name, once');
    check(names().indexOf('create-cleanup-group') > names().indexOf('get-category-automations'), 'pools are created after the reads and checks');
    source = 'notes';
    await call({ categoryId: CAT, cleanup: ['source'] });
    check(!names().includes('store-note-cleanups'), 'given cleanup replaces the note cleanup, so the note cleanup is not refreshed');
    source = 'ui';
    await call({ categoryId: CAT, cleanup: ['Big sink source', 'sink2'] });
    check(JSON.stringify(setCall()?.[1]?.categoriesWithTemplates?.[0]?.cleanup) === JSON.stringify([{ role: 'source', groupId: 'pool-big sink' }, { role: 'sink', groupId: null, weight: 2 }]), 'a pool named "Big sink" can send; "sink2" is a global sink of weight 2, as upstream parses them');
  }
  {
    await call({ categoryId: CAT, cleanup: ['Fun source', 'fun sink'] });
    check(sends.filter(([n]) => n === 'budget/create-cleanup-group').length === 1, 'the same pool in two cases is created once');
    const { res } = await call({ categoryId: CAT, cleanup: [] });
    check(res?.result?.cleanup === 0 && JSON.stringify(setCall()?.[1]?.categoriesWithTemplates?.[0]?.cleanup) === '[]', '[] clears the cleanup');
    await call({ categoryId: CAT, automations: [{ type: 'fixed' }] });
    check(!('cleanup' in setCall()[1].categoriesWithTemplates[0]), 'cleanup omitted is left as it is');
  }
  {
    const { err } = await call({ categoryId: MISSING, cleanup: ['Fun source'] });
    check(/not found/.test(err?.message ?? '') && !names().includes('create-cleanup-group'), 'a refusal creates no pool');
  }
  for (const [bad, re] of [
    [['#cleanup source'], /leave out the "#cleanup" prefix|leave out the \\"#cleanup\\" prefix/],
    [['  '], /cleanup/],
    [['Fun sink 1.5'], /cleanup line .{0,2}Fun sink 1\.5.{0,2} is not valid/],
    [['Fun sink 2 extra'], /cleanup line .{0,2}Fun sink 2 extra.{0,2} is not valid/],
    [['Trips\nsource'], /cleanup line/],
    [['Fun sources'], /cleanup line .{0,2}Fun sources.{0,2} is not valid/],
    [['sinkhole'], /cleanup line .{0,2}sinkhole.{0,2} is not valid/],
    [['sourced'], /cleanup line .{0,2}sourced.{0,2} is not valid/],
    [Array(21).fill('source'), /cleanup/],
  ]) {
    const { err } = await call({ categoryId: CAT, cleanup: bad });
    check(re.test(err?.message ?? ''), `cleanup rejects ${JSON.stringify(bad).slice(0, 40)}`, err?.message);
    check(sends.length === 0, 'adapter never reached');
  }
  {
    const { err } = await call({ categoryId: CAT });
    check(/give automations, cleanup or both/.test(err?.message ?? ''), 'neither automations nor cleanup is refused', err?.message);
  }

  console.log('\n[set-automations] importNoteTemplates mirrors the editor migration');
  {
    const now = new Date(2026, 10, 22);
    const cats = [{ id: INCOME, name: 'Salary' }];
    const sch = [{ id: SCHED, name: 'Rent' }];
    const imp = (t) => importNoteTemplates([t], sch, cats, now);
    check(imp({ type: 'percentage', percent: 10, category: 'salary', directive: 'template', priority: 0 })[0].category === INCOME, 'percentage: income name becomes its id');
    check(JSON.stringify(imp({ type: 'schedule', name: 'Rent ', directive: 'template', priority: 0 })[0]) === JSON.stringify({ type: 'schedule', name: 'Rent', directive: 'template', priority: 0, scheduleId: SCHED }), 'schedule: id and current name from the name');
    const lim = imp({ type: 'simple', limit: { amount: 300, hold: false, period: 'monthly' }, directive: 'template', priority: 2 });
    check(lim.length === 2 && lim[0].type === 'limit' && lim[0].amount === 300 && lim[0].priority === null && lim[1].type === 'refill' && lim[1].priority === 2, 'simple limit only: a limit and a refill');
    const both = imp({ type: 'simple', monthly: 40, limit: { amount: 300, hold: true, period: 'weekly' }, directive: 'template', priority: 0 });
    check(both.length === 2 && both[0].type === 'limit' && both[0].hold === true && both[1].type === 'periodic' && both[1].amount === 40 && both[1].starting === '2026-11-01', 'simple monthly + limit: a limit and a fixed amount');
    const per = imp({ type: 'periodic', amount: 20, period: { period: 'week', amount: 1 }, starting: '2026-01-05', limit: { amount: 100, hold: false, period: 'monthly' }, directive: 'template', priority: 1 });
    check(per.length === 2 && !('limit' in per[0]) && per[1].type === 'limit', 'periodic with a limit: split in two');
    check(imp({ type: 'simple', directive: 'template', priority: 0 }).length === 0, 'simple with neither: dropped');
    check(imp({ type: 'by', amount: 600, month: '2027-06', directive: 'template', priority: 0 })[0].type === 'by', 'anything else passes through');
  }

  source = 'ui'; existing = [];
  console.log('\n[set-automations] NEGATIVE: flags off');
  for (const [p, re] of [[{}, /Goal templates, then try again/], [{ 'flags.goalTemplatesEnabled': 'true' }, /Budget automations UI, then try again/]]) {
    prefs = p;
    const { err } = await call({ categoryId: CAT, automations: [{ type: 'refill' }] });
    check(re.test(err?.message ?? '') && /Settings > Experimental features/.test(err?.message ?? ''), `refused with ${JSON.stringify(p)}, naming the toggle`, err?.message);
    check(errorsMod.isPreflightRefusal(err) && err.refusalKind === 'feature-disabled', 'a typed feature-disabled refusal');
    check(sends.length === 0, 'nothing sent');
  }

  console.log('\n[set-automations] NEGATIVE: unknown ids');
  prefs = ON;
  for (const [input, msg] of [
    [{ categoryId: MISSING, automations: [] }, `Category "${MISSING}" not found. Use actual_categories_get to list available categories.`],
    [{ categoryId: CAT, automations: [{ type: 'schedule', scheduleId: MISSING }] }, `Schedule "${MISSING}" not found. Use actual_schedules_get to list available schedules.`],
    [{ categoryId: CAT, automations: [{ type: 'percentage', incomeCategory: CAT }] }, `Income category "${CAT}" not found. Use actual_categories_get to list available income categories.`],
  ]) {
    const { err } = await call(input);
    check(err?.message === msg, `refused: ${msg.slice(0, 40)}...`, err?.message);
    check(sends.length === 0, 'nothing sent');
  }

  console.log('\n[set-automations] NEGATIVE: schema');
  for (const [bad, re] of [
    [{ categoryId: CAT, automations: [{ type: 'refill', amount: 100 }] }, /amount is not valid for a refill automation/],
    [{ categoryId: CAT, automations: [{ type: 'schedule' }] }, /scheduleId is required for a schedule automation/],
    [{ categoryId: CAT, automations: [{ type: 'fixed', amount: 10.5 }] }, /amount/],
    [{ categoryId: CAT, automations: [{ type: 'by', month: '2026-13' }] }, /month must be in YYYY-MM format/],
    [{ categoryId: CAT, automations: [{ type: 'nope' }] }, /type/],
    [{ categoryId: 'x', automations: [] }, /categoryId/],
  ]) {
    const { err } = await call(bad);
    check(re.test(err?.message ?? ''), `rejects ${JSON.stringify(bad.automations ?? bad)}`, err?.message);
    check(sends.length === 0, 'adapter never reached');
  }

  console.log('');
  if (failures === 0) console.log('[set-automations] All categories_set_automations tests passed ✓');
  else { console.error(`[set-automations] ${failures} test(s) FAILED`); process.exit(2); }
})();
