// tests/unit/schema_date_calendar.test.js
//
// #745: every date the server stores or filters on must be a real calendar day, validated by one
// shared schema (CommonSchemas.date). Covers the schema table, the ten legacy transaction tools,
// the two legacy schedule tools, and the compact tools through their own re-checks.
//
// Run: node tests/unit/schema_date_calendar.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[schema-date-calendar]');

const { CommonSchemas } = await import('../../dist/src/lib/schemas/common.js');
const { formatZodError } = await import('../../dist/src/lib/zod-error-format.js');
const { isCalendarDay } = await import('../../dist/src/lib/dates.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');

const CAL = 'Invalid date (not a real calendar day)';
const SHAPE = 'Invalid date format (expected YYYY-MM-DD)';
const GOOD = '2024-02-29';
const BAD = '2018-02-30';

const messages = (r) => (r.success ? [] : r.error.issues.map((i) => i.message));

// ---- the shared schema ----

for (const v of ['2018-02-30', '2018-13-45', '2018-00-10', '2019-04-31', '2023-02-29', '2100-02-29', '0000-01-01', '0099-12-31']) {
  await check(`NEGATIVE: CommonSchemas.date refuses ${v} with exactly the calendar issue`, () => {
    assert.deepStrictEqual(messages(CommonSchemas.date.safeParse(v)), [CAL]);
  });
}
for (const v of ['2018-1-5', '2018-02-28\n']) {
  await check(`NEGATIVE: CommonSchemas.date gives a malformed ${JSON.stringify(v)} the shape issue only`, () => {
    assert.deepStrictEqual(messages(CommonSchemas.date.safeParse(v)), [SHAPE]);
  });
}
for (const v of ['2024-02-29', '2000-02-29']) {
  await check(`POSITIVE: CommonSchemas.date accepts the leap day ${v}`, () => {
    assert.strictEqual(CommonSchemas.date.safeParse(v).success, true);
  });
}
await check('isCalendarDay never throws and refuses non strings', () => {
  for (const v of [undefined, null, 20240229, {}, '']) assert.strictEqual(isCalendarDay(v), false);
});

// ---- legacy tools ----

const legacy = async (n) => (await import(`../../dist/src/tools/${n}.js`)).default;
const ID = '323e4567-e89b-42d3-a456-426614174002';
const ACC = '123e4567-e89b-42d3-a456-426614174000';
const wrap = {
  accounts_get_balance: (d) => [['cutoff', { id: ACC, cutoff: d }]],
  transactions_get: (d) => [['startDate', { startDate: d }], ['endDate', { endDate: d }]],
  transactions_filter: (d) => [['startDate', { startDate: d }], ['endDate', { endDate: d }]],
  transactions_search_by_payee: (d) => [['startDate', { payeeName: 'x', startDate: d }], ['endDate', { payeeName: 'x', endDate: d }]],
  transactions_search_by_amount: (d) => [['startDate', { minAmount: 1, startDate: d }], ['endDate', { minAmount: 1, endDate: d }]],
  transactions_search_by_category: (d) => [['startDate', { categoryName: 'x', startDate: d }], ['endDate', { categoryName: 'x', endDate: d }]],
  transactions_summary_by_payee: (d) => [['startDate', { startDate: d }], ['endDate', { endDate: d }]],
  transactions_summary_by_category: (d) => [['startDate', { startDate: d }], ['endDate', { endDate: d }]],
  transactions_update: (d) => [['fields.date', { id: ID, fields: { date: d } }]],
  transactions_update_batch: (d) => [['updates.0.fields.date', { updates: [{ id: ID, fields: { date: d } }] }]],
};
for (const [name, build] of Object.entries(wrap)) {
  const tool = await legacy(name);
  for (const [path, good] of build(GOOD)) {
    await check(`${tool.name}: ${path} accepts ${GOOD}`, () => {
      const r = tool.inputSchema.safeParse(good);
      assert.strictEqual(r.success, true, JSON.stringify(r.success ? [] : r.error.issues));
    });
  }
  for (const [path, bad] of build(BAD)) {
    await check(`NEGATIVE: ${tool.name}: ${path} refuses ${BAD} at its own path`, () => {
      const r = tool.inputSchema.safeParse(bad);
      assert.strictEqual(r.success, false);
      const hit = r.error.issues.filter((i) => i.path.join('.') === path);
      assert.deepStrictEqual(hit.map((i) => i.message), [CAL], JSON.stringify(r.error.issues));
    });
  }
}
await check('legacy update tools: date null is refused and an omitted date still parses (#814)', async () => {
  const u = await legacy('transactions_update');
  assert.strictEqual(u.inputSchema.safeParse({ id: ID, fields: { date: null } }).success, false);
  assert.strictEqual(u.inputSchema.safeParse({ id: ID, fields: { notes: 'x' } }).success, true);
  const b = await legacy('transactions_update_batch');
  assert.strictEqual(b.inputSchema.safeParse({ updates: [{ id: ID, fields: { date: null } }] }).success, false);
  assert.strictEqual(b.inputSchema.safeParse({ updates: [{ id: ID, fields: { notes: 'x' } }] }).success, true);
});

// ---- legacy transaction writes that already used CommonSchemas.date ----

const issueList = (r) => (r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
await check('NEGATIVE: legacy create, import and transfer refuse an impossible date with exactly one issue', async () => {
  const B = '223e4567-e89b-42d3-a456-426614174001';
  const create = await legacy('transactions_create');
  assert.deepStrictEqual(issueList(create.inputSchema.safeParse({ account: ACC, date: BAD, amount: -1 })), [`date: ${CAL}`]);
  const imp = await legacy('transactions_import');
  assert.deepStrictEqual(issueList(imp.inputSchema.safeParse({ accountId: ACC, txs: [{ date: BAD, amount: -1 }] })), [`txs.0.date: ${CAL}`]);
  const tr = await legacy('transfers_create');
  assert.deepStrictEqual(issueList(tr.inputSchema.safeParse({ from_account: ACC, to_account: B, amount: 1, date: BAD })), [`date: ${CAL}`]);
});

// ---- legacy schedules ----

const RECUR = { frequency: 'monthly', start: '2026-12-01' };
for (const name of ['schedules_create', 'schedules_update']) {
  const tool = await legacy(name);
  const withDate = (d) => (name === 'schedules_create' ? { name: 'x', account: ACC, date: d } : { id: ID, date: d });
  await check(`NEGATIVE: ${tool.name} refuses a one-off date of ${BAD} with the calendar text`, () => {
    const r = tool.inputSchema.safeParse(withDate(BAD));
    assert.strictEqual(r.success, false);
    assert.deepStrictEqual(r.error.issues.map((i) => [i.path.join('.'), i.message]), [['date', CAL]]);
  });
  await check(`NEGATIVE: ${tool.name} reports a malformed one-off date as exactly the shape message (oneOffDateSchema, not a bare "Invalid input")`, () => {
    const r = tool.inputSchema.safeParse(withDate('2018-1-5'));
    assert.strictEqual(r.success, false);
    assert.strictEqual(formatZodError(r.error), `Validation error: date: ${SHAPE}`);
  });
  await check(`POSITIVE: ${tool.name} accepts ${GOOD} and a recurrence object`, () => {
    assert.strictEqual(tool.inputSchema.safeParse(withDate(GOOD)).success, true);
    assert.strictEqual(tool.inputSchema.safeParse(withDate(RECUR)).success, true);
  });
}

// ---- compact tools ----

const phrases = legacyPhrases(COMPACT_TOOLS);
const seen = [];
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return {}; } };
const compact = (name) => buildCompactTool(COMPACT_TOOLS.find((t) => t.name === name), ops, phrases);
const refusedIssues = async (tool, input) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
  return (e.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);
};
const B2 = '223e4567-e89b-42d3-a456-426614174001';
const mt = compact('manage_transactions');
const cases = [
  ['create', { action: 'create', account: ACC, date: BAD, amount: -1 }, [`date: ${CAL}`]],
  ['update', { action: 'update', id: ID, date: '2018-13-45' }, [`date: ${CAL}`]],
  ['update_batch', { action: 'update_batch', updates: [{ id: ID, fields: { date: '2018-02-31' } }] }, [`updates.0: fields.date: ${CAL}`]],
  ['import', { action: 'import', account_id: ACC, txs: [{ date: BAD, amount: -1 }] }, [`txs.0: date: ${CAL}`]],
  ['transfer', { action: 'transfer', from_account: ACC, to_account: B2, amount: 5, date: '2019-04-31' }, [`date: ${CAL}`]],
];
for (const [action, input, expected] of cases) {
  await check(`NEGATIVE: manage_transactions ${action} reports an impossible date exactly once, nothing is called`, async () => {
    assert.deepStrictEqual(await refusedIssues(mt, input), expected);
  });
}
await check('POSITIVE: manage_transactions create accepts the leap day and forwards it', async () => {
  seen.length = 0;
  await mt.call({ action: 'create', account: ACC, date: GOOD, amount: -1 });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].a.date, GOOD);
});
await check('NEGATIVE: summarize_transactions balance reports a cutoff of 2019-02-30 exactly once', async () => {
  assert.deepStrictEqual(await refusedIssues(compact('summarize_transactions'), { report: 'balance', account_id: ACC, cutoff: '2019-02-30' }), [`cutoff: ${CAL}`]);
});
await check('NEGATIVE: search_transactions reports two impossible dates as exactly two issues (no doubling)', async () => {
  assert.deepStrictEqual(
    await refusedIssues(compact('search_transactions'), { by: 'filter', start_date: '2019-02-30', end_date: '2019-04-31' }),
    [`start_date: ${CAL}`, `end_date: ${CAL}`],
  );
});
await check('NEGATIVE: the dedupe is general: manage_transactions merge with equal ids reports its refine once', async () => {
  assert.deepStrictEqual(await refusedIssues(mt, { action: 'merge', ids: [ID, ID] }), ['ids: ids must be two DIFFERENT transaction ids']);
});
const ms = compact('manage_schedules');
for (const input of [
  { action: 'create', name: 'x', account: ACC, date: BAD },
  { action: 'update', id: ID, date: BAD },
]) {
  await check(`NEGATIVE: manage_schedules ${input.action} refuses a one-off date of ${BAD} with the calendar text`, async () => {
    assert.deepStrictEqual(await refusedIssues(ms, input), [`date: ${CAL}`]);
  });
}
await check('NEGATIVE: manage_schedules create keeps the shape text for a malformed date and gives no calendar text', async () => {
  assert.deepStrictEqual(
    await refusedIssues(ms, { action: 'create', name: 'x', account: ACC, date: '2018-1-5' }),
    ['date: date must be "YYYY-MM-DD" or a recurrence object {frequency, start, ...}'],
  );
});
await check('POSITIVE: manage_schedules create still takes a recurrence object and a real one-off date', async () => {
  seen.length = 0;
  await ms.call({ action: 'create', name: 'x', account: ACC, date: GOOD });
  await ms.call({ action: 'create', name: 'x', account: ACC, date: RECUR });
  assert.strictEqual(seen.length, 2);
});

console.log(`\n[schema-date-calendar] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
