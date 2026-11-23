// tests/unit/schedules_recur_validation.test.js
//
// #786: a recurrence must be usable before it is stored. RecurConfigSchema refuses an endMode
// without the field it needs, an impossible start or endDate, and an endDate before start, so
// the compact manage_schedules and the legacy actual_schedules_create and actual_schedules_update
// all refuse it before any write. Also pins that the compact `date` description publishes the
// recurrence shape (every key of the schema) while the published schema keeps no anyOf.
//
// Run: node tests/unit/schedules_recur_validation.test.js   (needs `npm run build` first)

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
console.log('\n[schedules-recur-validation]');

const recur = await import('../../dist/src/lib/schemas/recur.js');
const { RecurConfigSchema } = recur;
const { formatZodError } = await import('../../dist/src/lib/zod-error-format.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');
const { z } = await import('zod');
const legacy = async (n) => (await import(`../../dist/src/tools/${n}.js`)).default;

const NEED_OCC = 'endOccurrences is required when endMode is after_n_occurrences';
const NEED_DATE = 'endDate is required when endMode is on_date';
const END_BEFORE = 'endDate must not be before start';
const CAL = 'Invalid date (not a real calendar day)';
const SHAPE = 'Invalid date format (expected YYYY-MM-DD)';

const ACC = '123e4567-e89b-42d3-a456-426614174000';
const ID = '323e4567-e89b-42d3-a456-426614174002';
const base = { frequency: 'daily', start: '2027-04-01' };
const messages = (r) => (r.success ? [] : r.error.issues.map((i) => i.message));
const count = (text, needle) => text.split(needle).length - 1;

// ---- the exported texts ----

await check('the three refusal texts are exported and exact', () => {
  assert.strictEqual(recur.END_OCCURRENCES_REQUIRED, NEED_OCC);
  assert.strictEqual(recur.END_DATE_REQUIRED, NEED_DATE);
  assert.strictEqual(recur.END_BEFORE_START, END_BEFORE);
});

// ---- RecurConfigSchema ----

const accepted = {
  'daily, no end': base,
  'after_n_occurrences with endOccurrences': { ...base, endMode: 'after_n_occurrences', endOccurrences: 3 },
  'on_date with endDate': { ...base, endMode: 'on_date', endDate: '2027-04-30' },
  'on_date, endDate equal to start': { ...base, endMode: 'on_date', endDate: '2027-04-01' },
  'monthly with patterns and a leap day start': { frequency: 'monthly', start: '2028-02-29', patterns: [{ type: 'day', value: -1 }] },
  'endMode never with a stray endDate BEFORE start (what the Actual UI stores)': { ...base, endMode: 'never', endOccurrences: 1, endDate: '2000-01-01' },
  'endMode omitted with a stray endDate before start': { ...base, endDate: '2000-01-01' },
  'after_n_occurrences with a stray endDate before start': { ...base, endMode: 'after_n_occurrences', endOccurrences: 3, endDate: '2000-01-01' },
  'endMode never with a stray endDate (read-back echo)': { ...base, endMode: 'never', endDate: '2027-04-01' },
  'endMode never with a stray endOccurrences': { ...base, endMode: 'never', endOccurrences: 2 },
  'weekendSolveMode without skipWeekend (read-back echo)': { ...base, weekendSolveMode: 'after' },
};
for (const [label, v] of Object.entries(accepted)) {
  await check(`POSITIVE: RecurConfigSchema accepts ${label}`, () => {
    const r = RecurConfigSchema.safeParse(v);
    assert.strictEqual(r.success, true, JSON.stringify(r.success ? [] : r.error.issues));
  });
}

const refusedCases = [
  ['after_n_occurrences without endOccurrences', { ...base, endMode: 'after_n_occurrences' }, [NEED_OCC]],
  ['on_date without endDate', { ...base, endMode: 'on_date' }, [NEED_DATE]],
  ['on_date with endDate before start', { ...base, start: '2027-04-10', endMode: 'on_date', endDate: '2027-04-01' }, [END_BEFORE]],
  ['an impossible start (2027-02-30)', { frequency: 'monthly', start: '2027-02-30' }, [CAL]],
  ['an impossible start (2026-13-45)', { frequency: 'monthly', start: '2026-13-45' }, [CAL]],
  ['an impossible endDate (2027-04-31)', { ...base, endMode: 'on_date', endDate: '2027-04-31' }, [CAL]],
  ['a malformed start with the shape text only', { ...base, start: '2027-4-1' }, [SHAPE]],
  ['a malformed endDate with the shape text only', { ...base, endMode: 'on_date', endDate: '2027-4-1' }, [SHAPE]],
  ['an impossible start with an earlier endDate, one issue and no order issue', { ...base, start: '2027-02-30', endDate: '2027-01-01' }, [CAL]],
];
for (const [label, v, expected] of refusedCases) {
  await check(`NEGATIVE: RecurConfigSchema refuses ${label}`, () => {
    assert.deepStrictEqual(messages(RecurConfigSchema.safeParse(v)), expected);
  });
}
await check('NEGATIVE: the cross-field refusals sit at the root path', () => {
  const r = RecurConfigSchema.safeParse({ ...base, endMode: 'on_date' });
  assert.deepStrictEqual(r.error.issues.map((i) => i.path), [[]]);
});

// ---- legacy tools ----

const REFUSALS = [
  ['after_n_occurrences without endOccurrences', { ...base, endMode: 'after_n_occurrences' }, NEED_OCC],
  ['on_date without endDate', { ...base, endMode: 'on_date' }, NEED_DATE],
  ['an endDate before start', { ...base, start: '2027-04-10', endMode: 'on_date', endDate: '2027-04-01' }, END_BEFORE],
  ['an impossible start', { frequency: 'monthly', start: '2027-02-30' }, CAL],
  ['an impossible endDate', { ...base, endMode: 'on_date', endDate: '2027-04-31' }, CAL],
];

for (const name of ['schedules_create', 'schedules_update']) {
  const tool = await legacy(name);
  const withDate = (d) => (name === 'schedules_create' ? { name: 'x', account: ACC, date: d } : { id: ID, date: d });
  const text = (d) => {
    const r = tool.inputSchema.safeParse(withDate(d));
    return r.success ? null : formatZodError(r.error);
  };
  await check(`POSITIVE: ${tool.name} accepts a bounded recurrence`, () => {
    assert.strictEqual(tool.inputSchema.safeParse(withDate({ ...base, endMode: 'after_n_occurrences', endOccurrences: 3 })).success, true);
  });
  for (const [label, v, expected] of REFUSALS) {
    await check(`NEGATIVE: ${tool.name} refuses ${label} with the named text, once`, () => {
      const t = text(v);
      assert.ok(t, 'expected a refusal');
      assert.strictEqual(count(t, expected), 1, t);
    });
  }
  await check(`NEGATIVE: ${tool.name} keeps the shape text for a malformed recurrence start`, () => {
    const t = text({ ...base, start: '2027-4-1' });
    assert.ok(t && t.includes(SHAPE), String(t));
  });
}

// ---- compact manage_schedules ----

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_schedules');
const seen = [];
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return {}; } };
const tool = buildCompactTool(spec, ops, legacyPhrases(COMPACT_TOOLS));
const callText = async (input) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  return e ? e.message : null;
};
const create = (d) => ({ action: 'create', name: 'x', account: ACC, date: d });
const update = (d) => ({ action: 'update', id: ID, date: d });
for (const [action, build] of [['create', create], ['update', update]]) {
  await check(`POSITIVE: compact ${action} accepts end on the start day and a stray endDate with endMode never`, async () => {
    assert.strictEqual(await callText(build({ ...base, endMode: 'on_date', endDate: '2027-04-01' })), null);
    assert.strictEqual(await callText(build({ ...base, endMode: 'never', endDate: '2027-04-01' })), null);
  });
  for (const [label, v, expected] of REFUSALS) {
    await check(`NEGATIVE: compact ${action} refuses ${label} with the named text, once, and calls nothing`, async () => {
      const t = await callText(build(v));
      assert.ok(t, 'expected a refusal');
      assert.strictEqual(count(t, expected), 1, t);
      assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
    });
  }
}

// ---- the published description ----

const publishedDate = () => z.toJSONSchema(tool.inputSchema).properties.date.description;
await check('the compact date description names every key of RecurConfigSchema', () => {
  const d = publishedDate();
  for (const k of Object.keys(RecurConfigSchema.shape)) assert.ok(d.includes(k), `date description lacks ${k}`);
});
await check('the compact date description states monthly only, the patterns item shape and which endMode needs which key', () => {
  const d = publishedDate();
  for (const w of ['monthly only', 'patterns [{type', 'value}]', 'after_n_occurrences needs endOccurrences', 'on_date needs endDate', 'not before start']) {
    assert.ok(d.includes(w), `date description lacks "${w}"`);
  }
});
await check('the published schema still has no anyOf or oneOf', () => {
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(z.toJSONSchema(tool.inputSchema))));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
