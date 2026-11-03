// tests/unit/schedules_dates.test.js
// #479: actual_schedules_dates lists a schedule's dates through api.getScheduleDates.
// The raw api is stubbed BEFORE the adapter loads (it destructures the raw functions at
// import), and api init is disarmed so the real adapter method runs: the not-found refusal,
// the two typed preflight refusals and the count cap are all in the adapter, not the tool.
//
// One session is proven with the intruder on the api lock (the #484 pattern in
// get_context.test.js): the getSchedules stub enqueues an unawaited withApiLock intruder, the
// getScheduleDates stub asserts the lock is still held and the intruder has not run. A teeth case
// drives the split shape (adapter.getSchedules, then a second session) and requires a violation.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const SCHED_ID = '00000000-0000-0000-0000-000000000099';
const OTHER_ID = '00000000-0000-0000-0000-0000000000aa';
const RECUR = { frequency: 'monthly', start: '2024-06-01', interval: 1, skipWeekend: true, weekendSolveMode: 'after', endMode: 'never' };

// n ascending dates from 2027-01-01, one per day
const days = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let schedules = [];
  let datesCalls = [];
  let getSchedulesCalls = 0;
  let datesImpl = async () => [];
  let intruder = null;
  let violations = [];
  apiDefault.getSchedules = async () => {
    getSchedulesCalls++;
    if (!intruder) {
      const box = { ran: false };
      box.done = withApiLock(async () => { box.ran = true; });
      intruder = box;
    }
    return schedules;
  };
  apiDefault.getScheduleDates = async (date, opts) => {
    if (!isApiLockHeld() || intruder?.ran) violations.push('dates');
    datesCalls.push({ date, opts });
    return datesImpl(date, opts);
  };
  apiDefault.sync = async () => {};

  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/schedules_dates.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  const { withApiLock, isApiLockHeld } = await import('../../dist/src/lib/apiLock.js');
  adapterMod._setSkipApiInitForTests(true);

  const reset = () => {
    schedules = [{ id: SCHED_ID, name: 'Rent', next_date: '2024-06-03', date: RECUR }];
    datesCalls = []; getSchedulesCalls = 0; datesImpl = async () => [];
    intruder = null; violations = [];
  };

  console.log('\n[#479] positive: passes the schedule row\'s `date` field and the window through');
  {
    reset();
    datesImpl = async () => ['2024-06-03', '2024-07-01', '2024-08-01'];
    const res = await tool.call({ schedule_id: SCHED_ID, start: '2024-06-01', end: '2024-12-31', count: 3 });
    const r = res?.result;
    check(datesCalls.length === 1, 'getScheduleDates called once');
    check(getSchedulesCalls === 1, 'schedules read once, in the same session');
    check(datesCalls[0]?.date === RECUR, 'the RecurConfig from the row\'s `date` field is passed');
    check(datesCalls[0]?.opts?.start === '2024-06-01' && datesCalls[0]?.opts?.end === '2024-12-31', 'start and end forwarded');
    check(datesCalls[0]?.opts?.count === 4, 'count sent one above the requested 3', JSON.stringify(datesCalls[0]?.opts));
    check(r?.schedule_id === SCHED_ID && r?.name === 'Rent', 'id and name echoed');
    check(JSON.stringify(r?.dates) === '["2024-06-03","2024-07-01","2024-08-01"]', 'dates returned as given');
    check(r?.count === 3 && r?.truncated === false, 'count 3, not truncated');
    check(intruder !== null && violations.length === 0, 'the expansion ran in the same session as the listing', violations.join());
    await intruder?.done;
    check(intruder?.ran === true, 'intruder ran after the call released the lock');
  }

  console.log('\n[#479] positive: count 3 on an open-ended recurrence: more exist, so truncated');
  {
    reset();
    datesImpl = async (_d, opts) => days(opts.count);
    const r = (await tool.call({ schedule_id: SCHED_ID, count: 3 }))?.result;
    check(r?.count === 3 && r?.truncated === true, '3 returned, truncated true because a 4th exists', JSON.stringify(r));
  }

  console.log('\n[#479] positive: a one-off date passes through as a string');
  {
    reset();
    schedules = [{ id: SCHED_ID, name: 'Once', date: '2027-03-10' }];
    datesImpl = async (d) => (typeof d === 'string' ? [d] : []);
    const r = (await tool.call({ schedule_id: SCHED_ID, start: '2027-01-01' }))?.result;
    check(datesCalls[0]?.date === '2027-03-10', 'the one-off date string is passed');
    check(JSON.stringify(r?.dates) === '["2027-03-10"]' && r?.truncated === false, 'one date, not truncated');
  }

  console.log('\n[#479] positive: start and end omitted are not sent');
  {
    reset();
    await tool.call({ schedule_id: SCHED_ID, count: 2 });
    const o = datesCalls[0]?.opts ?? {};
    check(!('start' in o) && !('end' in o), 'no start/end keys when omitted', JSON.stringify(o));
  }

  console.log('\n[#479] positive: the cap is 366, and the extra date sets truncated');
  {
    reset();
    datesImpl = async (_d, opts) => days(opts.count);
    const r = (await tool.call({ schedule_id: SCHED_ID }))?.result;
    check(datesCalls[0]?.opts?.count === 367, 'no count requested: 367 sent');
    check(r?.dates?.length === 366 && r?.count === 366, '366 dates returned');
    check(r?.truncated === true, 'truncated when the extra date came back');
  }

  console.log('\n[#479] positive: fewer dates than the cap is not truncated');
  {
    reset();
    datesImpl = async () => days(5);
    const r = (await tool.call({ schedule_id: SCHED_ID, count: 5 }))?.result;
    check(r?.count === 5 && r?.truncated === false, '5 of 5 requested, not truncated');
  }

  console.log('\n[#479] positive: an end reached before the count is not truncated');
  {
    reset();
    datesImpl = async () => days(2);
    const r = (await tool.call({ schedule_id: SCHED_ID, end: '2027-01-02', count: 10 }))?.result;
    check(r?.count === 2 && r?.truncated === false, 'end stops it, not truncated');
  }

  console.log('\n[#479] negative: an unknown schedule id is a typed NotFoundRefusal');
  {
    reset();
    let err;
    try { await tool.call({ schedule_id: OTHER_ID }); } catch (e) { err = e; }
    check(err !== undefined, 'throws');
    check(isPreflightRefusal(err), 'isPreflightRefusal', err?.constructor?.name);
    check(/actual_schedules_get/.test(err?.message ?? ''), 'names actual_schedules_get', err?.message);
    check(datesCalls.length === 0, 'getScheduleDates never called');
  }

  console.log('\n[#479] negative: end before start is a typed refusal, before any API call');
  {
    reset();
    let err;
    try { await tool.call({ schedule_id: SCHED_ID, start: '2026-12-01', end: '2026-01-01' }); } catch (e) { err = e; }
    check(isPreflightRefusal(err), 'isPreflightRefusal', err?.message);
    check(/end \(2026-01-01\) is before start \(2026-12-01\)/.test(err?.message ?? ''), 'names both dates', err?.message);
    check(getSchedulesCalls === 0 && datesCalls.length === 0, 'no API call');
  }

  console.log('\n[#479] negative: skipWeekend without weekendSolveMode is a typed refusal');
  {
    reset();
    schedules = [{ id: SCHED_ID, name: 'Rent', date: { ...RECUR, weekendSolveMode: undefined } }];
    let err;
    try { await tool.call({ schedule_id: SCHED_ID }); } catch (e) { err = e; }
    check(isPreflightRefusal(err), 'isPreflightRefusal', err?.message);
    check(/weekendSolveMode/.test(err?.message ?? '') && /actual_schedules_update/.test(err?.message ?? ''), 'names the field and actual_schedules_update', err?.message);
    check(datesCalls.length === 0, 'getScheduleDates never called');
  }

  console.log('\n[#479] negative: any other upstream error passes through unchanged');
  {
    reset();
    datesImpl = async () => { throw new Error('end (2020-01-01) is before start (2026-11-03)'); };
    let err;
    try { await tool.call({ schedule_id: SCHED_ID, end: '2020-01-01' }); } catch (e) { err = e; }
    check(/end \(2020-01-01\) is before start \(2026-11-03\)/.test(err?.message ?? ''), 'upstream message kept', err?.message);
    check(!isPreflightRefusal(err), 'not a preflight refusal');
  }

  console.log('\n[#479] teeth: the witness goes red when listing and expansion use two sessions');
  {
    reset();
    const adapter = adapterMod.default;
    const list = await adapter.getSchedules();
    await adapterMod.withActualApi(() => apiDefault.getScheduleDates(list[0].date, { count: 2 }));
    await intruder?.done;
    check(violations.length === 1, 'split sessions are caught', String(violations.length));
  }

  console.log('\n[#479] negative: Zod rejects a bad count or id before any API call');
  for (const input of [
    { schedule_id: SCHED_ID, count: 0 },
    { schedule_id: SCHED_ID, count: 367 },
    { schedule_id: SCHED_ID, count: 1.5 },
    { schedule_id: 'not-a-uuid' },
    { schedule_id: SCHED_ID, start: '2026/01/01' },
  ]) {
    reset();
    let err;
    try { await tool.call(input); } catch (e) { err = e; }
    check(err !== undefined && getSchedulesCalls === 0 && datesCalls.length === 0, `rejected: ${JSON.stringify(input)}`);
  }

  console.log(`\n[schedules-dates] ${failures === 0 ? 'all passed' : failures + ' failed'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
