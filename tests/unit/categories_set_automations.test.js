// tests/unit/categories_set_automations.test.js
//
// #842: actual_categories_set_automations (experimental feature budget_automations). Drives the
// REAL adapter.setCategoryAutomations and the REAL tool with RAW api stubs (installed before the
// adapter import, session disarmed) and a test double for the internal-send seam.
//
// Upstream validates nothing on this save, so every guard is the adapter's. Each refusal asserts
// the EXACT message and that NOTHING WAS SENT: a send cannot be undone.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/categories_set_automations.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
// The read-back wait is bounded by half of this, so the "never settles" case takes 2 s.
process.env.ACTUAL_OP_TIMEOUT_MS  = '4000';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
const same = (actual, expected, label) => {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  a === e ? pass(label) : fail(label, `got ${a}, expected ${e}`);
};

const CAT = '80000000-0000-4000-8000-000000000001';
const INCOME = '80000000-0000-4000-8000-000000000002';
const EXPENSE = '80000000-0000-4000-8000-000000000003';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const SCHED = '80000000-0000-4000-8000-0000000000a1';
const SCHED_DEAD = '80000000-0000-4000-8000-0000000000a2';
const SCHED_BLANK = '80000000-0000-4000-8000-0000000000a3';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);

// ---- the stubbed budget ----
let flags;            // { goal, ui } values of the two preference rows; undefined = no row
let stored;           // the category row: { template_settings, goal_def, cleanup_def }
let note;             // the category note, or null
let currency;
let landAfterMs;      // 0: the send lands at once; N: the stored row changes N ms later; Infinity: never
let schedules;
const sent = [];
const queries = [];
const timers = [];

const reset = () => {
  flags = { goal: 'true', ui: 'true' };
  stored = { template_settings: JSON.stringify({ source: 'ui' }), goal_def: '[]', cleanup_def: null };
  note = null; currency = 'USD'; landAfterMs = 0;
  schedules = [
    { id: SCHED, name: 'Rent' },
    { id: SCHED_DEAD, name: 'Old', tombstone: 1 },
    { id: SCHED_BLANK, name: null },
  ];
  sent.length = 0; queries.length = 0; sendError = null; getSchedulesCalls = 0;
};
let sendError = null;

apiDefault.sync = async () => {};
apiDefault.runQuery = async (query) => {
  const s = query.serialize();
  queries.push(s.table);
  if (s.table === 'preferences') {
    const id = s.filterExpressions[0]?.id;
    const value = id === 'flags.goalTemplatesEnabled' ? flags.goal : id === 'flags.goalTemplatesUIEnabled' ? flags.ui : undefined;
    return { data: value === undefined ? [] : [{ id, value }] };
  }
  if (s.table === 'cleanup_groups') return { data: [] };
  if (s.table === 'categories' && s.selectExpressions.includes('template_settings')) {
    return { data: s.filterExpressions[0]?.id === CAT ? [{ id: CAT, ...stored }] : [] };
  }
  if (s.table === 'categories') return { data: [{ id: INCOME, name: 'Salary' }, { id: CAT, name: 'Rent' }] };
  throw new Error(`unexpected query on ${s.table}`);
};
apiDefault.getPreferences = async () => (currency === undefined ? {} : { defaultCurrencyCode: currency });
apiDefault.getNote = async () => (note === null ? null : { id: CAT, note });
let getSchedulesCalls = 0;
apiDefault.getSchedules = async () => { getSchedulesCalls++; return schedules; };
apiDefault.getCategories = async () => [
  { id: INCOME, name: 'Salary', is_income: true },
  { id: EXPENSE, name: 'Food', is_income: false },
  { id: CAT, name: 'Rent', is_income: false },
];

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const errors = await import('../../dist/src/lib/errors.js');
const { FeatureDisabledRefusal, NotFoundRefusal, OutOfRangeRefusal } = errors;
const tool = (await import('../../dist/src/tools/categories_set_automations.js')).default;

adapterMod._setInternalSendForTests(async (name, args) => {
  sent.push({ name, args });
  if (sendError) throw sendError;
  const apply = () => {
    // As upstream storeTemplates does: an empty list is stored as a NULL column.
    const list = args.categoriesWithTemplates[0].templates;
    stored = { template_settings: JSON.stringify({ source: args.source }), goal_def: list.length > 0 ? JSON.stringify(list) : null, cleanup_def: stored.cleanup_def };
  };
  if (landAfterMs === 0) apply();
  else if (landAfterMs !== Infinity) timers.push(setTimeout(apply, landAfterMs));
  return undefined;
});

const attempt = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const save = (automations, extra = {}, id = CAT) => attempt(adapter.setCategoryAutomations({ categoryId: id, automations, ...extra }));
const stored1 = () => sent[0]?.args.categoriesWithTemplates[0].templates;

const MSG = {
  M2: 'Budget automations UI is not enabled in this budget (setting flags.goalTemplatesUIEnabled). In Actual, turn it on under Settings > Experimental features, below Goal templates, then retry. Nothing was changed.',
  M4: "This category's automations come from its #template, #goal or #cleanup note lines. Saving switches it to the automations editor: those lines stop being read (the note text is kept, and its cleanup stays as last stored). Pass confirmNoteSwitch: true (manage_categories: confirm_note_switch) to confirm. Nothing was changed.",
  M1: 'Goal templates are not enabled in this budget. In Actual, turn on Settings > Experimental features > Goal templates, then retry. Nothing was changed.',
};
const PERIODIC = { type: 'periodic', amount: 5000, period: { period: 'month', amount: 1 }, starting: '2026-11-01' };

// ---------------------------------------------------------------------------
console.log('\n[#842 U1] a periodic entry is sent in the stored form, once, with source ui and no cleanup key');
reset();
{
  const input = [JSON.parse(JSON.stringify(PERIODIC))];
  const before = JSON.stringify(input);
  const { value, error } = await save(input);
  check(!error, 'no error', String(error?.message));
  same(sent, [{ name: 'budget/set-category-automations', args: { categoriesWithTemplates: [{ id: CAT, templates: [{ type: 'periodic', directive: 'template', amount: 50, period: { period: 'month', amount: 1 }, starting: '2026-11-01', priority: 1 }] }], source: 'ui' } }], 'exactly one send with the exact payload');
  check(!('cleanup' in sent[0].args.categoriesWithTemplates[0]) && !('cleanup' in sent[0].args), 'no cleanup key anywhere');
  check(JSON.stringify(input) === before, 'the caller input is not mutated');
  check(value?.verified === true && value?.source === 'ui', 'verified true and source ui');
  check(value?.automations?.[0]?.amount === 5000, 'the result is in minor units again', JSON.stringify(value?.automations));
}

console.log('\n[#842 U2] amounts follow the currency decimals');
for (const [code, minor, major] of [['JPY', 5000, 5000], ['KRW', 5000, 5000], ['IRR', 5000, 5000], ['EUR', 1234, 12.34], [undefined, 1234, 12.34]]) {
  reset(); currency = code;
  await save([{ type: 'goal', amount: minor }]);
  check(stored1()?.[0]?.amount === major, `${code ?? 'no currency'}: ${minor} stores ${major}`, JSON.stringify(stored1()));
}

console.log('\n[#842 U3] an empty list is sent as an empty list');
reset();
{
  stored.goal_def = JSON.stringify([{ type: 'goal', directive: 'goal', amount: 5 }]);
  const { error, value } = await save([]);
  check(!error, 'no error', String(error?.message));
  same(stored1(), [], 'templates []');
  check(stored.goal_def === null, 'the stub stores NULL for an empty list, as upstream does');
  check(value?.verified === true, 'a clear reads back as verified', JSON.stringify(value));
}

console.log('\n[#842 U4] directive, null priorities, description and categoryName');
reset();
{
  await save([
    { type: 'goal', amount: 100000, description: 'house' },
    { type: 'limit', amount: 20000, period: 'monthly' },
    { type: 'remainder', weight: 2 },
    { type: 'percentage', percent: 10, category: 'all income', categoryName: 'All income', description: 'tithe' },
  ]);
  const t = stored1();
  same(t?.[0], { type: 'goal', directive: 'goal', amount: 1000, description: 'house' }, 'goal: directive goal, no priority, description kept last');
  same(t?.[1], { type: 'limit', directive: 'template', amount: 200, period: 'monthly', hold: false, priority: null }, 'limit: priority null, hold defaults false');
  same(t?.[2], { type: 'remainder', directive: 'template', weight: 2, priority: null }, 'remainder: priority null');
  same(t?.[3], { type: 'percentage', directive: 'template', percent: 10, previous: false, category: 'all income', priority: 1, description: 'tithe' }, 'percentage: categoryName dropped');
}

console.log('\n[#842 U5] NEGATIVE: the two flags');
for (const [label, flag, value, message, type] of [
  ['goal flag "false"', 'goal', 'false', MSG.M1], ['goal flag absent', 'goal', undefined, MSG.M1],
  ['UI flag "false"', 'ui', 'false', MSG.M2], ['UI flag absent', 'ui', undefined, MSG.M2],
]) {
  reset(); flags[flag] = value;
  const { error } = await save([]);
  check(error instanceof FeatureDisabledRefusal && error.refusalKind === 'feature-disabled', `${label}: typed feature-disabled refusal`, String(error?.constructor?.name));
  check(error?.message === message, `${label}: exact message`, error?.message);
  check(sent.length === 0, `${label}: nothing sent`);
}
reset(); flags.goal = 'false'; flags.ui = 'false';
{
  const { error } = await save([]);
  check(error?.message === MSG.M1, 'both off: the goal flag is reported first');
}

console.log('\n[#842 U6] NEGATIVE: an unknown category');
reset();
{
  const { error } = await save([], {}, UNKNOWN);
  check(error instanceof NotFoundRefusal && error.refusalKind === 'not-found', 'typed not-found refusal');
  check(error?.message === `Category "${UNKNOWN}" not found. Use actual_categories_get to list available categories.`, 'exact message', error?.message);
  check(sent.length === 0, 'nothing sent');
}

console.log('\n[#842 U7] the note switch');
for (const text of ['#template 50', 'Rent #template 50', '#goal 500', '  #CLEANUP food source']) {
  reset(); stored.template_settings = null; note = text;
  const { error } = await save([]);
  check(error instanceof OutOfRangeRefusal && error.message === MSG.M4 && error.value === CAT, `note ${JSON.stringify(text)}: refused with the exact message and the category id`, error?.message);
  check(sent.length === 0, `note ${JSON.stringify(text)}: nothing sent`);
}
for (const text of ['groceries', '#Template 50', 'x #foo #template 5']) {
  reset(); stored.template_settings = null; note = text;
  const { error } = await save([]);
  check(!error, `note ${JSON.stringify(text)}: no line would be read, so no confirm is needed`, String(error?.message));
  check(sent.length === 1, `note ${JSON.stringify(text)}: sent`);
}
reset(); note = '#template 50';
{
  const { error } = await save([]);
  check(!error && sent.length === 1, 'source ui with a note: sent without a confirm', String(error?.message));
}
reset(); stored.template_settings = null; note = '#template 50';
{
  const { error } = await save([], { confirmNoteSwitch: true });
  check(!error && sent.length === 1, 'confirmNoteSwitch true: sent', String(error?.message));
  check(stored.template_settings === JSON.stringify({ source: 'ui' }), 'the category now reads as ui');
}

console.log('\n[#842 U8, #847] schedules are stored by id and name');
reset();
{
  const { error } = await save([{ type: 'schedule', scheduleId: SCHED }]);
  check(!error, 'a live schedule by id', String(error?.message));
  same(stored1(), [{ type: 'schedule', directive: 'template', scheduleId: SCHED, name: 'Rent', priority: 1 }], 'stored as { type, directive, scheduleId, name, priority }');
  check(getSchedulesCalls === 1, 'the schedules are read once per save, the read-back adds none', String(getSchedulesCalls));
}
reset();
{
  await save([{ type: 'schedule', name: 'Rent', priority: 3 }]);
  same(stored1(), [{ type: 'schedule', directive: 'template', scheduleId: SCHED, name: 'Rent', priority: 3 }], 'by name, stored with the resolved id and its priority');
}
for (const [label, entry, ctor, text] of [
  ['unknown id', { type: 'schedule', scheduleId: UNKNOWN }, NotFoundRefusal, `Schedule "${UNKNOWN}" not found. Use actual_schedules_get to list available schedules.`],
  ['tombstoned id', { type: 'schedule', scheduleId: SCHED_DEAD }, NotFoundRefusal, `Schedule "${SCHED_DEAD}" not found. Use actual_schedules_get to list available schedules.`],
  ['unknown name', { type: 'schedule', name: 'Nope' }, NotFoundRefusal, 'Schedule "Nope" not found. Use actual_schedules_get to list available schedules.'],
  ['null name', { type: 'schedule', scheduleId: SCHED_BLANK }, OutOfRangeRefusal, `Schedule "${SCHED_BLANK}" has no name: the entry is stored with the schedule's name, and Actual fails to apply one whose name is missing, so name it in Actual first. Nothing was changed.`],
]) {
  reset();
  const { error } = await save([entry]);
  check(error instanceof ctor && error.message === text, `${label}: typed refusal with the exact message`, error?.message);
  check(sent.length === 0, `${label}: nothing sent`);
}
reset();
{
  const none = await save([{ type: 'schedule' }]);
  check(none.error?.name === 'ZodError' && /give scheduleId or name\./.test(none.error.message), 'neither: a schema error', none.error?.message);
  check(sent.length === 0, 'nothing sent');
}

console.log('\n[#847] a read result carrying both fields or scheduleMissing saves back');
reset();
{
  // As the read returns an entry this server saved, after the schedule was renamed: the id wins.
  schedules = [{ id: SCHED, name: 'Rent 2027' }];
  const { error } = await save([{ type: 'schedule', scheduleId: SCHED, name: 'Rent' }]);
  check(!error, 'both scheduleId and name: accepted', String(error?.message));
  same(stored1(), [{ type: 'schedule', directive: 'template', scheduleId: SCHED, name: 'Rent 2027', priority: 1 }], 'resolved by id, the live name stored');
}
reset();
{
  const { error } = await save([{ type: 'schedule', name: 'Rent', scheduleMissing: true }]);
  check(!error, 'scheduleMissing with a live "Rent": saved', String(error?.message));
  check(stored1()?.length === 1 && !('scheduleMissing' in stored1()[0]), 'the sent template has no scheduleMissing', JSON.stringify(stored1()));
}
reset(); schedules = [];
{
  const { error } = await save([{ type: 'schedule', name: 'Rent', scheduleMissing: true }]);
  check(error instanceof NotFoundRefusal && error.message === 'Schedule "Rent" not found. Use actual_schedules_get to list available schedules.', 'scheduleMissing with no live "Rent": NotFoundRefusal naming it', error?.message);
  check(sent.length === 0, 'nothing sent');
}

reset(); schedules = [{ id: SCHED, name: ' Rent ' }];
{
  await save([{ type: 'schedule', scheduleId: SCHED }]);
  same(stored1(), [{ type: 'schedule', directive: 'template', scheduleId: SCHED, name: 'Rent', priority: 1 }], 'a padded schedule name is stored trimmed (by id)');
  reset(); schedules = [{ id: SCHED, name: ' Rent ' }];
  await save([{ type: 'schedule', name: 'Rent' }]);
  same(stored1(), [{ type: 'schedule', directive: 'template', scheduleId: SCHED, name: 'Rent', priority: 1 }], 'and matched and stored trimmed (by name)');
}

console.log('\n[#842] dates are bounded to years 1970 to 2199');
for (const [label, entry, path] of [
  ['periodic starting 0001', { ...PERIODIC, starting: '0001-01-01' }, '0.starting'],
  ['periodic starting 2200', { ...PERIODIC, starting: '2200-01-01' }, '0.starting'],
  ['weekly limit start 1969', { type: 'limit', amount: 100, period: 'weekly', start: '1969-12-29' }, '0.start'],
  ['by month 0001', { type: 'by', amount: 100, month: '0001-01' }, '0.month'],
]) {
  reset();
  const { error } = await save([entry]);
  check(error?.name === 'ZodError' && error.issues.some((i) => i.path.join('.') === path && i.message === 'the year must be between 1970 and 2199.'), `${label}: refused with the year message`, error?.message);
  check(sent.length === 0, `${label}: nothing sent`);
}
reset();
{
  const { error } = await save([{ ...PERIODIC, starting: '1970-01-01' }, { type: 'by', amount: 100, month: '2199-12' }]);
  check(!error, 'the bounds themselves are accepted', String(error?.message));
}

console.log('\n[#842 U9] percentage sources');
reset();
{
  const { error } = await save([{ type: 'percentage', percent: 10, category: EXPENSE }]);
  check(error instanceof OutOfRangeRefusal && error.message === `percentage category "${EXPENSE}" is not an income category: use an income category id, "all income" or "available funds". Nothing was changed.`, 'an expense category: M6', error?.message);
  check(sent.length === 0, 'nothing sent');
  const unknown = await save([{ type: 'percentage', percent: 10, category: UNKNOWN }]);
  check(unknown.error instanceof NotFoundRefusal && unknown.error.message === `Category "${UNKNOWN}" not found. Use actual_categories_get to list available categories.`, 'an unknown id: M3', unknown.error?.message);
  check(sent.length === 0, 'nothing sent');
}
for (const source of ['all income', 'available funds', INCOME]) {
  reset();
  const { error } = await save([{ type: 'percentage', percent: 10, category: source }]);
  check(!error && stored1()?.[0]?.category === source, `${source}: sent`, String(error?.message));
}

console.log('\n[#842 U10] combination rules');
const COMBOS = [
  ['two limits', [{ type: 'limit', amount: 1, period: 'monthly' }, { type: 'limit', amount: 2, period: 'monthly' }], 'only one limit is allowed per category.'],
  ['two goals', [{ type: 'goal', amount: 1 }, { type: 'goal', amount: 2 }], 'only one goal is allowed per category.'],
  ['refill without a limit', [{ type: 'refill' }], 'refill needs a limit in the same list.'],
  ['percentages over 100', [{ type: 'percentage', percent: 60, category: 'all income' }, { type: 'percentage', percent: 60, category: 'all income' }], 'percentages of one income source total more than 100.'],
  ['schedule and by on different priorities', [{ type: 'schedule', name: 'Rent', priority: 1 }, { type: 'by', amount: 100, month: '2027-01', priority: 2 }], 'schedule and by entries must share one priority.'],
  ['a weekly limit without start', [{ type: 'limit', amount: 1, period: 'weekly' }], 'a weekly limit needs start (YYYY-MM-DD).'],
];
for (const [label, list, text] of COMBOS) {
  reset();
  const { error } = await save(list);
  check(error?.name === 'ZodError' && error.issues.some((i) => i.message === text), `${label}: ${text}`, error?.message);
  check(sent.length === 0, `${label}: nothing sent`);
}
reset();
{
  const ok = await save([{ type: 'percentage', percent: 60, category: 'all income' }, { type: 'percentage', percent: 60, category: 'available funds' }]);
  check(!ok.error && sent.length === 1, 'two sources at 60 and 60: sent', String(ok.error?.message));
  const limitAndRefill = await save([{ type: 'limit', amount: 1, period: 'monthly' }, { type: 'refill' }]);
  check(!limitAndRefill.error, 'a refill beside a limit is accepted', String(limitAndRefill.error?.message));
}

console.log('\n[#842 U11] strict entries');
for (const [label, call] of [
  ['a caller source', { categoryId: CAT, automations: [], source: 'notes' }],
  ['a caller cleanup', { categoryId: CAT, automations: [], cleanup: [] }],
]) {
  reset();
  const { error } = await attempt(tool.call(call));
  check(error !== undefined && sent.length === 0, `${label}: refused by the tool, nothing sent`);
}
for (const [label, list] of [
  ['an unknown key on periodic', [{ ...PERIODIC, bogus: 1 }]],
  ['type nope', [{ type: 'nope' }]],
  ['a weekly limit without start', [{ type: 'limit', amount: 1, period: 'weekly' }]],
  ['a caller directive of the wrong value', [{ type: 'periodic', directive: 'goal', amount: 1, period: { period: 'month', amount: 1 }, starting: '2026-11-01' }]],
  ['a negative amount', [{ type: 'goal', amount: -1 }]],
  ['more than 50 entries', Array.from({ length: 51 }, () => ({ type: 'goal', amount: 1 }))],
]) {
  reset();
  const { error } = await save(list);
  check(error?.name === 'ZodError', `${label}: a schema error`, String(error?.message).slice(0, 120));
  check(sent.length === 0, `${label}: nothing sent`);
}
{
  const strictKeys = tool.inputSchema.safeParse({ categoryId: CAT, automations: [], source: 'ui' });
  check(!strictKeys.success, 'the tool schema refuses a caller source');
  const noCleanup = tool.inputSchema.safeParse({ categoryId: CAT, automations: [], cleanup: [] });
  check(!noCleanup.success, 'the tool schema refuses a caller cleanup');
  const path = tool.inputSchema.safeParse({ categoryId: CAT, automations: [PERIODIC, { type: 'limit', amount: 1, period: 'weekly' }] });
  check(!path.success && path.error.issues.some((i) => i.path.join('.') === 'automations.1' || i.path.join('.').startsWith('automations.1')), 'a strict failure is reported under automations.<index>', JSON.stringify(path.error?.issues));
}

console.log('\n[#842 U12] the send is not retried');
reset(); sendError = new Error('upstream exploded');
{
  const { error } = await save([]);
  check(error?.message === 'upstream exploded', 'the error surfaces', error?.message);
  check(sent.length === 1, 'sent exactly once', String(sent.length));
}

console.log('\n[#842 U13] the read-back');
reset(); landAfterMs = 300;
{
  const started = Date.now();
  const { value, error } = await save([{ type: 'goal', amount: 123456 }]);
  check(!error && value?.verified === true, 'a row that lands 300 ms late is verified', String(error?.message));
  check(Date.now() - started >= 250, 'the call waited for it');
  check(value?.automations?.[0]?.amount === 123456, 'the returned automations are in minor units', JSON.stringify(value?.automations));
}
reset(); landAfterMs = Infinity;
{
  const started = Date.now();
  const { value, error } = await save([{ type: 'goal', amount: 1 }]);
  check(!error && value?.verified === false, 'a row that never lands: verified false', String(error?.message));
  check(Date.now() - started < 3900, 'within the bound', String(Date.now() - started));
}
timers.forEach(clearTimeout);

console.log('\n[#842 U14] a read result is accepted back');
reset();
{
  const storedList = [
    { type: 'periodic', directive: 'template', amount: 50, period: { period: 'month', amount: 1 }, starting: '2026-11-01', priority: 1 },
    { type: 'limit', directive: 'template', amount: 200, period: 'monthly', hold: false, priority: null },
    { type: 'remainder', directive: 'template', weight: 1, priority: null },
    { type: 'percentage', directive: 'template', percent: 10, previous: false, category: INCOME, priority: 2 },
    { type: 'goal', directive: 'goal', amount: 1000 },
  ];
  stored.goal_def = JSON.stringify(storedList);
  const { automations } = await adapter.getCategoryAutomations(CAT);
  check(automations.length === 5 && automations[3].categoryName === 'Salary', 'the read result carries categoryName');
  const { error } = await save(automations);
  check(!error, 'accepted back by the write schema', String(error?.message));
  same(stored1(), storedList, 'sent as stored, null priorities kept, categoryName dropped');
  const bad = await save(automations.map((a) => (a.type === 'limit' ? { ...a, priority: 1 } : a)));
  check(bad.error?.name === 'ZodError' && bad.error.issues.some((i) => i.path.join('.') === '1.priority'), 'a limit with priority 1 is refused on the entry priority', JSON.stringify(bad.error?.issues?.map((i) => i.path)));
}

// ---------------------------------------------------------------------------
console.log('\n[#842] the tool and the order of checks');
reset();
{
  const result = await tool.call({ categoryId: CAT, automations: [PERIODIC] });
  check(result?.result?.verified === true || result?.verified === true, 'the tool returns the adapter result');
  check(tool.name === 'actual_categories_set_automations', 'tool name');
}
reset(); flags.ui = 'false';
{
  const { error } = await save([{ type: 'schedule', scheduleId: UNKNOWN }], {}, UNKNOWN);
  check(error?.message === MSG.M2, 'flags are checked before the category and the schedule');
}
reset(); stored.template_settings = null; note = '#template 50';
{
  const { error } = await save([{ type: 'schedule', scheduleId: UNKNOWN }]);
  check(error?.message === MSG.M4, 'the note switch is checked before schedules');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
process.exit(0);
