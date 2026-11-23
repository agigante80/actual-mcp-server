// tests/unit/prompts_completion.test.js
//
// #775: prompt argument completion through completion/complete and a title per argument. The pure
// completers (clock faked the way prompt_monthly_review.test.js does), capCompletions, the handler
// through an SDK Server and Client, the raw prompts/list titles, the capability wiring.
//
// Run: node tests/unit/prompts_completion.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { stripTsComments } from './helpers/source-text.js';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[prompts-completion]');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { z } = await import('zod');
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { CompleteResultSchema, ListPromptsResultSchema } = await import('@modelcontextprotocol/sdk/types.js');
const { registerPromptHandlers } = await import('../../dist/src/lib/promptHandlers.js');
const { assertArgumentTitles } = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { recentMonths } = await import('../../dist/src/prompts/dates.js');
const C = await import('../../dist/src/prompts/completions.js');

// The clock is stubbed from LOCAL components, which is what dates.ts reads.
const RealDate = Date;
function stubClock(y, monthIndex, d) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(y, monthIndex, d, 12, 0, 0); }
    static now() { return new RealDate(y, monthIndex, d, 12).getTime(); }
  };
}
function withClock(y, monthIndex, d, fn) {
  stubClock(y, monthIndex, d);
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
async function withClockAsync(y, monthIndex, d, fn) {
  stubClock(y, monthIndex, d);
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}

// ---------------------------------------------------------------- recentMonths
await check('recentMonths: 12 months newest first, across a year boundary', () => {
  const l = recentMonths('2026-01', 12);
  assert.strictEqual(l.length, 12);
  assert.strictEqual(l[0], '2026-01');
  assert.strictEqual(l[1], '2025-12');
  assert.strictEqual(l[11], '2025-02');
});

// ---------------------------------------------------------------- completers
await check('completeMonth: empty prefix gives 2026-11 down to 2025-12', () => {
  const v = withClock(2026, 10, 15, () => C.completeMonth(''));
  assert.strictEqual(v.length, 12);
  assert.strictEqual(v[0], '2026-11');
  assert.strictEqual(v[11], '2025-12');
});
await check('completeMonth: prefix 2026-1 gives 2026-11 then 2026-10', () => {
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeMonth('2026-1')), ['2026-11', '2026-10']);
});
await check('completeMonth: a non-matching and a too-long prefix give nothing', () => {
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeMonth('1999')), []);
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeMonth('2026-11-extra')), []);
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeMonth('x'.repeat(5000))), []);
});
await check('completeMonth: a 7 and a 10 character prefix', () => {
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeMonth('2026-11')), ['2026-11']);
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeMonth('2026-11-01')), []);
});
await check('completeEndMonth: starts at the PREVIOUS month and ends 2025-11', () => {
  const v = withClock(2026, 10, 15, () => C.completeEndMonth(''));
  assert.strictEqual(v.length, 12);
  assert.strictEqual(v[0], '2026-10');
  assert.strictEqual(v[11], '2025-11');
});
await check('year boundary: clock 2026-01-31 month lists back to 2025-02, end_month starts 2025-12', () => {
  const m = withClock(2026, 0, 31, () => C.completeMonth(''));
  assert.strictEqual(m[0], '2026-01');
  assert.strictEqual(m[11], '2025-02');
  const e = withClock(2026, 0, 31, () => C.completeEndMonth(''));
  assert.strictEqual(e[0], '2025-12');
  assert.strictEqual(e[11], '2025-01');
});
await check('month end 2026-03-31 and December 2026-12-31 do not overflow', () => {
  assert.strictEqual(withClock(2026, 2, 31, () => C.completeEndMonth(''))[0], '2026-02');
  const dec = withClock(2026, 11, 31, () => C.completeMonth(''));
  assert.strictEqual(dec[0], '2026-12');
  assert.strictEqual(dec[11], '2026-01');
  assert.strictEqual(withClock(2026, 11, 31, () => C.completeEndMonth(''))[0], '2026-11');
});
await check('completeDay: today, first of this month, first of last month', () => {
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeDay('')), ['2026-11-15', '2026-11-01', '2026-10-01']);
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeDay('2026-10')), ['2026-10-01']);
});
await check('completeDay on the 1st has no duplicate; January rolls back to December; long prefix is empty', () => {
  assert.deepStrictEqual(withClock(2026, 10, 1, () => C.completeDay('')), ['2026-11-01', '2026-10-01']);
  assert.deepStrictEqual(withClock(2026, 0, 15, () => C.completeDay('')), ['2026-01-15', '2026-01-01', '2025-12-01']);
  assert.deepStrictEqual(withClock(2026, 10, 15, () => C.completeDay('2026-11-15-and-more')), []);
});
await check('completeMonthCount: 3, 6, 12, 24; prefix 1 gives 12', () => {
  assert.deepStrictEqual(C.completeMonthCount(''), ['3', '6', '12', '24']);
  assert.deepStrictEqual(C.completeMonthCount('1'), ['12']);
  assert.deepStrictEqual(C.completeMonthCount('9'), []);
});
await check('capCompletions: 101 inputs are cut to 100 with hasMore, 100 are not', () => {
  const a = C.capCompletions(Array.from({ length: 101 }, (_, i) => String(i)));
  assert.strictEqual(a.values.length, 100);
  assert.strictEqual(a.total, 101);
  assert.strictEqual(a.hasMore, true);
  const b = C.capCompletions(Array.from({ length: 100 }, (_, i) => String(i)));
  assert.strictEqual(b.values.length, 100);
  assert.strictEqual(b.hasMore, false);
  assert.deepStrictEqual(C.capCompletions([]), { values: [], total: 0, hasMore: false });
});

// ---------------------------------------------------------------- titles
await check('every real argument carries a non-empty title and a complete hook', () => {
  assertArgumentTitles(PROMPT_DEFINITIONS);
  for (const d of PROMPT_DEFINITIONS) {
    for (const a of d.arguments) assert.strictEqual(typeof a.complete, 'function', `${d.name}.${a.name}`);
  }
});
await check('assertArgumentTitles rejects a missing or blank title, naming prompt and argument', () => {
  const bad = (title) => [{ name: 'p', arguments: [{ name: 'a', title, description: 'd', required: false }] }];
  assert.throws(() => assertArgumentTitles(bad(undefined)), /p.*a/);
  assert.throws(() => assertArgumentTitles(bad('  ')), /p.*a/);
  assertArgumentTitles(bad('Ok'));
});

// ---------------------------------------------------------------- handler through an SDK pair
const hidden = PROMPT_DEFINITIONS.find((d) => d.name === 'monthly_review');
const noHook = {
  name: 'no_hook', title: 'No hook', description: 'd',
  arguments: [{ name: 'x', title: 'X', description: 'd', required: false }],
  requiredTools: [], argsSchema: z.strictObject({}), render: () => 't',
};
async function connect(offered) {
  const server = new Server({ name: 't', version: '1' }, { capabilities: { prompts: {}, completions: {} } });
  registerPromptHandlers(server, offered);
  const client = new Client({ name: 'c', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const complete = (c, params) => c.request({ method: 'completion/complete', params }, CompleteResultSchema);
const raw = (c, params) => c.request({ method: 'completion/complete', ...(params === undefined ? {} : { params }) }, z.looseObject({}));
async function errorOf(p) { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); }
const ref = (name) => ({ type: 'ref/prompt', name });
const EMPTY = { values: [], total: 0, hasMore: false };
const FIXED = 'Invalid completion request: ref must be {type, name} and argument must be {name, value} strings';

const offeredAll = PROMPT_DEFINITIONS;
await check('monthly_review month with prefix 2026-1 through the wire (clock 2026-11-15)', async () => {
  const c = await connect(offeredAll);
  const r = await withClockAsync(2026, 10, 15, () => complete(c, { ref: ref('monthly_review'), argument: { name: 'month', value: '2026-1' } }));
  assert.deepStrictEqual(r.completion, { values: ['2026-11', '2026-10'], total: 2, hasMore: false });
});
await check('monthly_review month with an empty value gives 12 values', async () => {
  const c = await connect(offeredAll);
  const r = await withClockAsync(2026, 10, 15, () => complete(c, { ref: ref('monthly_review'), argument: { name: 'month', value: '' } }));
  assert.strictEqual(r.completion.values.length, 12);
  assert.strictEqual(r.completion.values[0], '2026-11');
  assert.strictEqual(r.completion.values[11], '2025-12');
});
await check('spending_patterns end_month starts at 2026-10 and months with value 1 gives 12', async () => {
  const c = await connect(offeredAll);
  const e = await withClockAsync(2026, 10, 15, () => complete(c, { ref: ref('spending_patterns'), argument: { name: 'end_month', value: '' } }));
  assert.strictEqual(e.completion.values[0], '2026-10');
  assert.strictEqual(e.completion.values[11], '2025-11');
  const m = await complete(c, { ref: ref('spending_patterns'), argument: { name: 'months', value: '1' } });
  assert.deepStrictEqual(m.completion.values, ['12']);
});
await check('date and since complete to today and two month starts; on the 1st no duplicate', async () => {
  const c = await connect(offeredAll);
  for (const [prompt, arg] of [['spending_check', 'date'], ['budget_cleanup', 'date'], ['categorize_uncategorized', 'since']]) {
    const r = await withClockAsync(2026, 10, 15, () => complete(c, { ref: ref(prompt), argument: { name: arg, value: '' } }));
    assert.deepStrictEqual(r.completion.values, ['2026-11-15', '2026-11-01', '2026-10-01'], `${prompt}.${arg}`);
  }
  const first = await withClockAsync(2026, 10, 1, () => complete(c, { ref: ref('spending_check'), argument: { name: 'date', value: '' } }));
  assert.deepStrictEqual(first.completion.values, ['2026-11-01', '2026-10-01']);
});
await check('a prompt not offered and an unknown prompt give the same empty list, no error', async () => {
  const c = await connect(offeredAll.filter((d) => d !== hidden));
  const a = await complete(c, { ref: ref('monthly_review'), argument: { name: 'month', value: '' } });
  const b = await complete(c, { ref: ref('no_such_prompt'), argument: { name: 'month', value: '' } });
  assert.deepStrictEqual(a.completion, EMPTY);
  assert.deepStrictEqual(b.completion, EMPTY);
  const none = await connect([]);
  assert.deepStrictEqual((await complete(none, { ref: ref('monthly_review'), argument: { name: 'month', value: '' } })).completion, EMPTY);
});
await check('ref/resource, an unknown argument and an argument without a hook give an empty list', async () => {
  const c = await connect([...offeredAll, noHook]);
  assert.deepStrictEqual((await complete(c, { ref: { type: 'ref/resource', uri: 'file:///x' }, argument: { name: 'month', value: '' } })).completion, EMPTY);
  assert.deepStrictEqual((await complete(c, { ref: ref('monthly_review'), argument: { name: 'nope', value: '' } })).completion, EMPTY);
  assert.deepStrictEqual((await complete(c, { ref: ref('no_hook'), argument: { name: 'x', value: '' } })).completion, EMPTY);
});
await check('a malformed request is -32602 with the fixed message and no echo, never -32603', async () => {
  const c = await connect(offeredAll);
  const cases = [
    { ref: ref('monthly_review') },
    { ref: ref('monthly_review'), argument: { name: 'month', value: 12345 } },
    { ref: 'SECRET-REF', argument: { name: 'month', value: '' } },
    { ref: ref('monthly_review'), argument: 'SECRET-ARG' },
    { ref: { type: 7 }, argument: { name: 'month', value: '' } },
    { ref: { type: 'ref/prompt' }, argument: { name: 'month', value: '' } },
    { ref: { type: 'ref/prompt', name: 42 }, argument: { name: 'month', value: '' } },
    { ref: ref('monthly_review'), argument: { name: 5, value: '' } },
    undefined,
  ];
  for (const p of cases) {
    const e = await errorOf(raw(c, p));
    assert.strictEqual(e.code, -32602, JSON.stringify(p));
    assert.ok(e.message.endsWith(FIXED), e.message);
    assert.ok(!e.message.includes('SECRET') && !e.message.includes('12345'), e.message);
  }
});
await check('a huge hostile value is only prefix compared and never echoed', async () => {
  const c = await connect(offeredAll);
  const r = await complete(c, { ref: ref('monthly_review'), argument: { name: 'month', value: 'EVIL'.repeat(50000) } });
  assert.deepStrictEqual(r.completion, EMPTY);
});

// ---------------------------------------------------------------- raw prompts/list
await check('prompts/list carries title on every argument in the raw result and no complete key', async () => {
  const c = await connect(offeredAll);
  const loose = ListPromptsResultSchema.extend({
    prompts: z.array(z.looseObject({ arguments: z.array(z.looseObject({})).optional() })),
  });
  const r = await c.request({ method: 'prompts/list' }, loose);
  assert.strictEqual(r.prompts.length, offeredAll.length);
  for (const p of r.prompts) {
    for (const a of p.arguments) {
      assert.ok(typeof a.title === 'string' && a.title.length > 0, `${p.name}.${a.name}`);
      assert.deepStrictEqual(Object.keys(a).sort(), ['description', 'name', 'required', 'title']);
    }
  }
  const mr = r.prompts.find((p) => p.name === 'monthly_review');
  assert.strictEqual(mr.arguments[0].title, 'Month');
});

// ---------------------------------------------------------------- capability wiring
await check('a Server without completions makes registerPromptHandlers throw the SDK message', () => {
  const server = new Server({ name: 't', version: '1' }, { capabilities: { prompts: {} } });
  assert.throws(() => registerPromptHandlers(server, offeredAll), /Server does not support completions/);
});
const read = (rel) => stripTsComments(readFileSync(join(ROOT, rel), 'utf8'));
await check('src/index.ts, the http fallback and both ActualMCPConnection literals declare completions', () => {
  assert.ok(/completions:\s*true/.test(read('src/index.ts')), 'src/index.ts rawCapabilities');
  assert.ok(/completions:\s*\{\}/.test(read('src/server/httpServer.ts')), 'httpServer.ts fallback');
  const conn = read('src/lib/ActualMCPConnection.ts');
  assert.strictEqual(conn.split(/completions:\s*\{\}/).length - 1, 2, 'ActualMCPConnection has two literals');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
