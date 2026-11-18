// The default date range of the two summary tools is the caller's LOCAL month to date.
// It was computed with toISOString(), which is UTC: on a host east of UTC the first day
// of the month came out as the last day of the previous month, so "this month" silently
// included a day of last month (found by the #683 review). The zone is pinned to UTC+14
// here, the offset where the old code was wrong at every hour of the day.
process.env.TZ = 'Pacific/Kiritimati';

import assert from 'node:assert/strict';

const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const { localIsoDate } = await import('../../dist/src/lib/localDate.js');
adapter.runQuery = async () => ({ data: [] });

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name} -> ${e.message}`); }
};

const pad = (n) => String(n).padStart(2, '0');
// The tool takes its own `new Date()`, so a run that straddles local midnight sees a different
// day than a single reading taken here. Bracket the call and accept either side.
const startOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

for (const file of ['transactions_summary_by_category', 'transactions_summary_by_payee']) {
  const tool = (await import(`../../dist/src/tools/${file}.js`)).default;
  const before = new Date();
  const r = await tool.call({});
  const after = new Date();
  check(`${file}: default start is the first day of the local month`, () =>
    assert.ok([startOf(before), startOf(after)].includes(r.dateRange.startDate), r.dateRange.startDate));
  check(`${file}: default end is the local today`, () =>
    assert.ok([dayOf(before), dayOf(after)].includes(r.dateRange.endDate), r.dateRange.endDate));
  const given = await tool.call({ startDate: '2026-01-05', endDate: '2026-01-20' });
  check(`${file}: NEGATIVE: given dates are passed through unchanged`, () =>
    assert.deepEqual(given.dateRange, { startDate: '2026-01-05', endDate: '2026-01-20' }));
}

check('localIsoDate formats local components, zero padded', () =>
  assert.equal(localIsoDate(new Date(2026, 0, 1)), '2026-01-01'));
check('NEGATIVE: the UTC rendering of local midnight is the previous day in this zone', () =>
  assert.notEqual(new Date(2026, 0, 1).toISOString().split('T')[0], '2026-01-01'));

console.log(`[summary-default-dates] Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
