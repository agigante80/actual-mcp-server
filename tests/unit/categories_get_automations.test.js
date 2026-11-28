// tests/unit/categories_get_automations.test.js
//
// #840: actual_categories_get_automations (experimental feature budget_automations). Drives the
// REAL adapter.getCategoryAutomations with RAW api stubs (installed before the adapter import,
// session disarmed), because the read, the currency rule and the unknown-id refusal live there.
//
// The stored money is CURRENCY UNITS (`#template 50` is stored as monthly 50); the tool returns
// integer minor units using the budget's defaultCurrencyCode, exactly as upstream converts it.
// Every case also asserts the read stayed a PURE READ: no internal send and no write.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/categories_get_automations.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
const same = (actual, expected, label) => {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  a === e ? pass(label) : fail(label, `got ${a}, expected ${e}`);
};

const CAT = '60000000-0000-4000-8000-000000000001';
const INCOME = '60000000-0000-4000-8000-000000000002';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);

// What the stubbed budget holds; each case sets these.
let category = null;       // the categories row for CAT, or null
let currency;              // defaultCurrencyCode preference
let note = null;           // the category note text
const groups = [{ id: 'g1', name: 'Bills' }];
const SCHED = '70000000-0000-4000-8000-000000000001';
// #847: the live schedules the marker checks against; a live "Rent" keeps the #840 cases unmarked.
let schedules = [{ id: SCHED, name: 'Rent', tombstone: false }];
const calls = { queries: [], getNote: 0, getPreferences: 0, getSchedules: 0, writes: 0 };
const countWrite = (name) => async () => { calls.writes++; throw new Error(`unexpected write: ${name}`); };

apiDefault.sync = async () => {};
apiDefault.runQuery = async (query) => {
  const s = query.serialize();
  calls.queries.push(s.table);
  if (s.table === 'cleanup_groups') return { data: groups };
  if (s.table === 'categories' && s.selectExpressions.includes('template_settings')) {
    const wanted = s.filterExpressions[0]?.id;
    return { data: category && category.id === wanted ? [category] : [] };
  }
  if (s.table === 'categories') return { data: [{ id: INCOME, name: 'Salary' }, { id: CAT, name: 'Rent' }] };
  throw new Error(`unexpected query on ${s.table}`);
};
apiDefault.getPreferences = async () => { calls.getPreferences++; return currency === undefined ? {} : { defaultCurrencyCode: currency }; };
apiDefault.getNote = async () => { calls.getNote++; return note === null ? null : { id: CAT, note }; };
apiDefault.getSchedules = async () => { calls.getSchedules++; return schedules; };
// The internal handler bus cannot be stubbed: `api.internal` is a non-configurable getter that is
// null until init, which this harness skips. So a read that reached `api.internal.send` would throw a
// TypeError and fail every value assertion below; no separate counter is kept for it.
for (const name of ['updateCategory', 'updateNote', 'createCategory', 'deleteCategory', 'batchBudgetUpdates', 'setBudgetAmount']) {
  apiDefault[name] = countWrite(name);
}

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { NotFoundRefusal, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const ui = (goal, extra = {}) => ({ id: CAT, template_settings: JSON.stringify({ source: 'ui' }), goal_def: JSON.stringify(goal), cleanup_def: null, ...extra });
const run = async (id = CAT) => {
  calls.queries = []; calls.getNote = 0; calls.getPreferences = 0; calls.getSchedules = 0; calls.writes = 0;
  try { return { value: await adapter.getCategoryAutomations(id) }; } catch (err) { return { error: err }; }
};
const pure = (label) => check(calls.writes === 0, `${label}: no write`, JSON.stringify(calls));

console.log('\n[#840] editor-managed categories: amounts become integer minor units');
{
  category = ui([{ type: 'periodic', amount: 12.34, period: { period: 'month', amount: 1 } }]); currency = 'USD';
  let r = await run();
  same(r.value.automations[0].amount, 1234, 'USD 12.34 gives 1234'); same(r.value.source, 'ui', 'source ui'); pure('USD');
  check(calls.getNote === 0, 'an editor-managed category does not read the note');

  category = ui([{ type: 'schedule', name: 'Rent', monthly: 5000 }]); currency = 'JPY';
  r = await run(); same(r.value.automations[0].monthly, 5000, 'JPY monthly 5000 stays 5000'); pure('JPY');

  category = ui([{ type: 'schedule', name: 'Rent', monthly: 50 }]); currency = 'HUF';
  r = await run(); same(r.value.automations[0].monthly, 5000, 'HUF monthly 50 gives 5000 (HUF has 2 places upstream, not Intl 0)'); pure('HUF');

  currency = undefined;
  r = await run(); same(r.value.automations[0].monthly, 5000, 'no currency preference gives 5000'); pure('no currency');

  category = ui([{ type: 'periodic', amount: 100, period: { period: 'month', amount: 1 }, adjustmentType: 'percent', adjustment: 10 }]); currency = 'USD';
  r = await run(); same(r.value.automations[0].adjustment, 10, 'a percent adjustment 10 is unchanged');
  category = ui([{ type: 'periodic', amount: 100, period: { period: 'month', amount: 1 }, adjustmentType: 'fixed', adjustment: 2.5 }]);
  r = await run(); same(r.value.automations[0].adjustment, 250, 'a fixed adjustment 2.5 gives 250');

  category = ui([{ type: 'limit', amount: 500, period: 'monthly' }, { type: 'refill', weight: 1 }]);
  r = await run();
  same(r.value.automations.map((a) => a.amount ?? null), [50000, null], 'limit 500 gives 50000');
  same(r.value.automations[1], { type: 'refill', weight: 1 }, 'refill is unchanged');
  pure('limit and refill');
}

console.log('\n[#847] a schedule entry Actual can no longer resolve carries scheduleMissing');
{
  currency = 'USD';
  const entry = (fields) => { category = ui([{ type: 'schedule', directive: 'template', priority: 0, ...fields }]); };
  const marked = async (label, expected) => {
    const r = await run();
    const got = r.value?.automations?.[0];
    if (expected) same(got?.scheduleMissing, true, `${label}: scheduleMissing true`);
    else check(got !== undefined && !('scheduleMissing' in got), `${label}: no scheduleMissing key`, JSON.stringify(got));
    pure(label);
    return r;
  };

  schedules = [{ id: SCHED, name: 'Rent 2027', tombstone: false }];
  entry({ scheduleId: SCHED, name: 'Rent' });
  await marked('id live after a rename', false);
  check(calls.getSchedules === 1, 'the schedules are read once per read', JSON.stringify(calls));

  schedules = [];
  await marked('id gone', true);
  schedules = [{ id: SCHED, name: 'Rent', tombstone: true }];
  await marked('id only on a deleted schedule', true);
  schedules = [{ id: SCHED, name: null, tombstone: false }];
  await marked('id on a schedule with no name (upstream skips it)', true);

  schedules = [{ id: SCHED, name: 'Rent 2027', tombstone: false }];
  entry({ name: 'Rent' });
  const r = await marked('name only, renamed', true);
  same(r.value.automations[0], { type: 'schedule', directive: 'template', priority: 0, name: 'Rent', scheduleMissing: true }, 'the marked entry is otherwise as stored');
  schedules = [{ id: SCHED, name: '', tombstone: false }];
  await marked('name only, the schedule name emptied', true);
  schedules = [{ id: SCHED, name: 'Rent ', tombstone: false }];
  await marked('"Rent " on the schedule matches a stored "Rent"', false);
  schedules = [{ id: SCHED, name: 'Rent', tombstone: false }];
  entry({ name: 'Rent ' });
  await marked('a stored "Rent " is marked: upstream looks it up untrimmed', true);
  entry({ name: 'Rent' });
  schedules = [{ id: SCHED, name: 'rent', tombstone: false }];
  await marked('"rent" does not match "Rent" (case sensitive)', true);

  schedules = [];
  category = ui([{ type: 'periodic', amount: 1, period: { period: 'month', amount: 1 } }]);
  await run();
  check(calls.getSchedules === 0, 'no schedule entry: the schedules are never read', JSON.stringify(calls));
  category = ui([{ type: 'periodic', amount: 1, period: { period: 'month', amount: 1 }, description: 'schedule' }]);
  await run();
  check(calls.getSchedules === 0, 'a description reading "schedule" does not trigger the read', JSON.stringify(calls));
  schedules = [{ id: SCHED, name: 'Rent', tombstone: false }];
}

console.log('\n[#840] cleanup roles carry the group name');
{
  category = ui([{ type: 'refill' }], { cleanup_def: JSON.stringify([{ role: 'source', groupId: 'g1' }]) });
  const r = await run();
  same(r.value.cleanup, [{ role: 'source', groupId: 'g1', groupName: 'Bills' }], 'cleanup entry resolves groupName');
  pure('cleanup');
}

console.log('\n[#840] stored errors and unknown types go to errors, never converted as money');
{
  category = ui([{ type: 'error', line: '#template ???', error: 'bad' }, { type: 'nope', amount: 7 }]);
  const r = await run();
  same(r.value.errors, [{ type: 'error', line: '#template ???', error: 'bad' }, { type: 'nope' }], 'error entry and unknown type are reported');
  same(r.value.automations, [], 'neither is returned as an automation');
  pure('errors');
}

console.log('\n[#840] note-managed categories return the note directives');
{
  category = { id: CAT, template_settings: null, goal_def: JSON.stringify([{ type: 'simple', monthly: 999 }]), cleanup_def: null };
  note = 'Rent\npay #template 50'; currency = 'USD';
  let r = await run();
  same(r.value, { categoryId: CAT, source: 'notes', noteDirectives: ['#template 50'], cleanup: [] }, 'note "Rent / pay #template 50" gives ["#template 50"]');
  check(calls.getNote === 1, 'the note is read once, inside the one cycle');
  pure('note');

  note = null;
  r = await run(); same(r.value.noteDirectives, [], 'a notes category with no note gives []');

  note = '#template 50';
  category = { id: CAT, template_settings: null, goal_def: null, cleanup_def: null };
  r = await run(); same(r.value.noteDirectives, ['#template 50'], 'a never-applied note (goal_def null) still gives its directive');

  note = '#CLEANUP sink';
  r = await run(); same(r.value.noteDirectives, ['#CLEANUP sink'], '#CLEANUP sink is returned as written');
  same(r.value.cleanup, [], 'and the stored cleanup stays empty (notes are not applied yet)');

  category = { id: CAT, template_settings: '{not json', goal_def: null, cleanup_def: null };
  r = await run(); same(r.value.source, 'notes', 'unparsable template_settings is treated as notes');
}

console.log('\n[#840] an unknown category is refused with a typed NotFoundRefusal');
{
  category = null;
  const r = await run(UNKNOWN);
  check(r.error instanceof NotFoundRefusal && isPreflightRefusal(r.error), 'NotFoundRefusal, recognised by isPreflightRefusal', String(r.error));
  check(r.error?.message === `Category "${UNKNOWN}" not found. Use actual_categories_get to list available categories.`, 'exact message', r.error?.message);
  pure('unknown');
  check(calls.getNote === 0 && calls.getPreferences === 0, 'nothing else is read for an unknown id');
}

console.log('\n[#840] the tool wraps the adapter result and rejects bad input');
{
  const tool = (await import('../../dist/src/tools/categories_get_automations.js')).default;
  category = ui([{ type: 'refill' }]);
  const out = await tool.call({ categoryId: CAT });
  check((out.result ?? out).source === 'ui', 'tool returns the adapter result');
  const bad = await tool.call({ categoryId: CAT, extra: 1 }).then(() => null, (e) => e);
  check(bad !== null && /extra/.test(String(bad.message)), 'NEGATIVE: an extra field is refused naming it (strict schema)', String(bad?.message));
  const missing = await tool.call({}).then(() => null, (e) => e);
  check(missing !== null && /categoryId/.test(String(missing.message)), 'NEGATIVE: a missing categoryId is refused naming the field', String(missing?.message));
  const empty = await tool.call({ categoryId: '' }).then(() => null, (e) => e);
  check(empty !== null && /categoryId|uuid/i.test(String(empty.message)), 'NEGATIVE: an empty categoryId is refused', String(empty?.message));
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
