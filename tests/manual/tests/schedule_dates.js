import { fail } from '../assert.js';
/**
 * tests/manual/tests/schedule_dates.js
 *
 * SCHEDULE DATES TESTS (#479): actual_schedules_dates, split out of schedule.js (400-line limit).
 *
 * Covers:
 *   positive: next three dates of a last-day schedule from next_date, truncated
 *             weekend move over fixed 2024 dates (completed: unit test only)
 *             one-off listed in its window
 *   negative: end before start refused (OutOfRangeRefusal wording)
 *             one-off after its window returns an empty list
 *             skipWeekend without weekendSolveMode refused, naming actual_schedules_update
 *
 * Naming pattern: MCP-Schedule-{timestamp}: matched by cleanup.js. Every schedule is deleted
 * in a finally.
 *
 * Reads from context:  (none required)
 * Writes to context:   (none)
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} _context
 */
export async function scheduleDatesTests(client, _context) {
  const { callTool } = client;
  const timestamp = Date.now();
  console.log('\n-- Running SCHEDULE DATES TESTS --');

  // Upstream computes next_date from max(today, start): use the 3rd of next month.
  const now = new Date();
  const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const m = (now.getMonth() + 1) % 12;
  const ymd = (day) => `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const lastDay = new Date(y, m + 1, 0).getDate();

  console.log('Listing upcoming dates of a last-day schedule (actual_schedules_dates, #479)...');
  let datesId;
  try {
    const created = await callTool('actual_schedules_create', {
      name: `MCP-Schedule-Dates-${timestamp}`,
      date: { frequency: 'monthly', start: ymd(3), endMode: 'never', patterns: [{ type: 'day', value: -1 }] },
      amount: -5000,
      posts_transaction: false,
    });
    datesId = created?.id ?? created?.result?.id ?? created;
    const res = await callTool('actual_schedules_dates', { schedule_id: datesId, start: ymd(1), count: 3 });
    const r = res?.result ?? res;
    const lastOfMonth = (s) => { const [yy, mm, dd] = s.split('-').map(Number); return dd === new Date(yy, mm, 0).getDate(); };
    if (r?.count === 3 && r?.dates?.[0] === ymd(lastDay) && r.dates.every(lastOfMonth) && r.truncated === true) {
      console.log(`  ✓ schedule dates: ${r.dates.join(', ')}`);
    } else {
      fail(`schedule dates: expected 3 last-day dates from ${ymd(lastDay)}, got ${JSON.stringify(r).slice(0, 200)}`);
    }

    console.log('NEGATIVE: schedule dates with end before start (#479)...');
    try {
      await callTool('actual_schedules_dates', { schedule_id: datesId, start: ymd(20), end: ymd(10) });
      fail('Expected end before start to be refused, but the call succeeded');
    } catch (err) {
      const msg = err.message || String(err);
      // our refusal's wording only: upstream's own error also says "before start"
      if (msg.includes('must be on or after start')) console.log(`  ✓ end before start refused: ${msg.slice(0, 120)}`);
      else fail(`Threw, but the message does not name the range: ${msg.slice(0, 120)}`);
    }
  } catch (err) {
    fail(`schedule dates failed: ${err.message}`);
  } finally {
    if (typeof datesId === 'string') {
      try { await callTool('actual_schedules_delete', { id: datesId }); } catch (err) { fail(`delete dates schedule failed: ${err.message}`); }
    }
  }

  // #479: fixed past dates, so the expected lists are exact and do not depend on today.
  console.log('Listing weekend-moved, completed and one-off schedule dates (#479)...');
  const datesIds = [];
  try {
    const weekend = await callTool('actual_schedules_create', {
      name: `MCP-Schedule-DatesWeekend-${timestamp}`,
      date: { frequency: 'monthly', start: '2024-01-01', endMode: 'never', skipWeekend: true, weekendSolveMode: 'after' },
      amount: -5000,
      posts_transaction: false,
    });
    const weekendId = weekend?.id ?? weekend?.result?.id ?? weekend;
    datesIds.push(weekendId);
    const want = ['2024-06-03', '2024-07-01', '2024-08-01', '2024-09-02', '2024-10-01', '2024-11-01', '2024-12-02'];
    const w = await callTool('actual_schedules_dates', { schedule_id: weekendId, start: '2024-06-01', end: '2024-12-31' });
    const wr = w?.result ?? w;
    if (JSON.stringify(wr?.dates) === JSON.stringify(want) && wr?.truncated === false) {
      console.log(`  ✓ weekend move: ${wr.dates.join(', ')}`);
    } else {
      fail(`weekend move: expected ${want.join(', ')}, got ${JSON.stringify(wr).slice(0, 240)}`);
    }

    // The "completed schedule still expands" case lives in tests/unit/schedules_dates.test.js:
    // upstream updateSchedule refuses `completed` as system-managed, so no MCP call can set it.

    const oneOff = await callTool('actual_schedules_create', {
      name: `MCP-Schedule-DatesOneOff-${timestamp}`,
      date: '2024-03-15',
      amount: -5000,
      posts_transaction: false,
    });
    const oneOffId = oneOff?.id ?? oneOff?.result?.id ?? oneOff;
    datesIds.push(oneOffId);
    const inWin = await callTool('actual_schedules_dates', { schedule_id: oneOffId, start: '2024-03-01' });
    const past = await callTool('actual_schedules_dates', { schedule_id: oneOffId, start: '2024-04-01' });
    const inR = inWin?.result ?? inWin ?? {}; const pastR = past?.result ?? past ?? {};
    if (JSON.stringify(inR.dates) === '["2024-03-15"]' && inR.truncated === false
        && Array.isArray(pastR.dates) && pastR.dates.length === 0 && pastR.count === 0) {
      console.log('  ✓ one-off: listed in its window, empty after it');
    } else {
      fail(`one-off: got in-window ${JSON.stringify(inR).slice(0, 160)}, after ${JSON.stringify(pastR).slice(0, 160)}`);
    }
  } catch (err) {
    fail(`schedule dates (fixed cases) failed: ${err.message}`);
  } finally {
    for (const id of datesIds) {
      if (typeof id !== 'string') continue;
      try { await callTool('actual_schedules_delete', { id }); } catch (err) { fail(`delete dates schedule failed: ${err.message}`); }
    }
  }

  console.log('NEGATIVE: schedule dates with skipWeekend but no weekendSolveMode (#479)...');
  let incompleteId;
  try {
    const created = await callTool('actual_schedules_create', {
      name: `MCP-Schedule-DatesNoSolve-${timestamp}`,
      // Weekly from a Monday: upstream computes next_date at create and throws if it lands on a
      // weekend with no weekendSolveMode, so a monthly fixture would fail on some run days.
      date: { frequency: 'weekly', start: '2024-01-01', endMode: 'never', skipWeekend: true },
      amount: -5000,
      posts_transaction: false,
    });
    incompleteId = created?.id ?? created?.result?.id ?? created;
    try {
      await callTool('actual_schedules_dates', { schedule_id: incompleteId, start: '2024-06-01', count: 2 });
      fail('Expected skipWeekend without weekendSolveMode to be refused, but the call succeeded');
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('weekendSolveMode') && msg.includes('actual_schedules_update')) console.log(`  ✓ incomplete weekend config refused: ${msg.slice(0, 120)}`);
      else fail(`Threw, but the message does not name weekendSolveMode and actual_schedules_update: ${msg.slice(0, 120)}`);
    }
  } catch (err) {
    fail(`create incomplete weekend schedule failed: ${err.message}`);
  } finally {
    if (typeof incompleteId === 'string') {
      try { await callTool('actual_schedules_delete', { id: incompleteId }); } catch (err) { fail(`delete incomplete weekend schedule failed: ${err.message}`); }
    }
  }
}
