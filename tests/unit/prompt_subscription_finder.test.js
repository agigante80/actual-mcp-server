// tests/unit/prompt_subscription_finder.test.js
//
// #776: the subscription_finder prompt: the shared calendar-checked date argument, the exact twelve
// month window, the explicit-yes rule, the no-write-name text and the offer matrix.
//
// Run: node tests/unit/prompt_subscription_finder.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-subscription-finder]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded, assertArgumentTitles,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { EMPTY_RESULT_LINE } = await import('../../dist/src/prompts/shared.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'subscription_finder');
const render = (args) => renderPrompt(def, args);
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const YES = 'Never create anything from the table without a yes for that item.';
const ONE = 'ONE at a time';
const WEAK = 'Two sightings are a weak signal';
const BIG = 'ignore every payee that appears in only one month, without listing it';
const QUARTERLY = 'a typical gap of 3 months is quarterly';
const EVERY3 = 'interval 3';
const CENTS = 'Amounts are integer cents; divide by 100 and show currency.';

await check('subscription_finder is registered last with its title and one optional date argument', () => {
  assert.ok(def, 'subscription_finder must be in PROMPT_DEFINITIONS');
  assert.strictEqual(PROMPT_DEFINITIONS[PROMPT_DEFINITIONS.length - 1], def);
  assert.strictEqual(def.title, 'Subscription finder');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.title, a.required]), [['date', 'As-of date', false]]);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
  assertArgumentTitles(PROMPT_DEFINITIONS);
});

await check('requiredTools is exact; every compact tool the text names is required (no write tool allowed)', () => {
  assert.deepStrictEqual(def.requiredTools, ['summarize_transactions', 'list_entities']);
  const text = render({ date: '2026-11-13' });
  const compact = [...manager.getCompactToolNames()];
  const tokens = text.match(/[a-z_]+/g);
  for (const t of tokens) {
    if (compact.includes(t)) assert.ok(def.requiredTools.includes(t), `${t} is named but not required`);
  }
  for (const t of def.requiredTools) assert.ok(tokens.includes(t), `${t} should be named in the text`);
  assert.ok(!text.includes('manage_'), 'the text names no manage_ tool');
});

await check('the text pins the explicit-yes rule, one at a time, the weak signal and cents; no dash, dollar or placeholder', () => {
  const text = render({ date: '2026-11-13' });
  for (const s of [YES, ONE, WEAK, BIG, QUARTERLY, EVERY3, CENTS, EMPTY_RESULT_LINE, 'at least 3 different months', 'within 10 percent']) {
    assert.ok(text.includes(s), `missing: ${s}`);
  }
  assert.ok(text.includes('group_by ["payee", "month"]'));
  assert.ok(text.includes('list_entities with type schedule'));
  assert.ok(text.includes('If you have no such tool, end after the table.'));
  assert.ok(!EM_EN.test(text), 'no em or en dash');
  assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
  assert.ok(!/\{[a-z_]+\}/.test(text), 'no unfilled placeholder');
  assert.strictEqual(text.replace(YES, '').includes(YES), false);
});

await check('date: accepts real days; refuses impossible, malformed and hostile values; unknown keys', () => {
  for (const date of ['2026-11-13', '2024-02-29']) assert.deepStrictEqual(def.argsSchema.parse({ date }), { date });
  const bad = ['2026-02-29', '2026-02-31', '2026-13-01', '2026-11-1', ' 2026-11-13', 'x'.repeat(10000), 20261113, null, 'Jan-SECRET-123'];
  for (const date of bad) assert.throws(() => def.argsSchema.parse({ date }), `must refuse ${JSON.stringify(String(date).slice(0, 12))}`);
  assert.throws(() => def.argsSchema.parse({ dryRun: 'x' }));
});

await check('render fills the exact twelve month window', () => {
  const cases = [
    ['2026-11-15', '2025-12-01', '2026-11-30'],
    ['2026-01-10', '2025-02-01', '2026-01-31'],
    ['2024-02-29', '2023-03-01', '2024-02-29'],
    ['2025-03-31', '2024-04-01', '2025-03-31'],
    ['2026-12-31', '2026-01-01', '2026-12-31'],
  ];
  for (const [date, start, end] of cases) {
    const text = render({ date });
    assert.ok(text.includes(`from ${start} to ${end}`), `${date}: window ${start} to ${end}`);
    assert.ok(text.includes(`start_date ${start}, end_date ${end}`), `${date}: call dates`);
    assert.ok(text.includes(`as of ${date}`), date);
  }
});

const { formatZodError } = await import('../../dist/src/lib/zod-error-format.js');
const messageOf = (args) => {
  try { render(args); } catch (err) { return formatZodError(err, def.argsSchema); }
  throw new Error(`expected a refusal for ${JSON.stringify(args)}`);
};
await check('an empty or blank date is omitted; a bad date is one readable value-free message (#772)', () => {
  const base = render({});
  assert.strictEqual(render({ date: '' }), base);
  assert.strictEqual(render({ date: '   ' }), base);
  for (const bad of ['2026-13-01', '2026-02-30', 'yesterday', '2026-1-1']) {
    const m = messageOf({ date: bad });
    assert.ok(m.includes('date: must be YYYY-MM-DD, a real calendar day'), m);
    assert.ok(!m.includes(bad), m);
  }
  assert.ok(messageOf({ date: null }).includes('date'));
});

const RealDate = Date;
function withClock(y, monthIndex, d, h, fn) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(y, monthIndex, d, h, 0, 0); }
    static now() { return new RealDate(y, monthIndex, d, h).getTime(); }
  };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
const countOf = (s, sub) => s.split(sub).length - 1;

await check('a defaulted date is labelled as the server clock and a supplied one is not (#774)', () => {
  const text = withClock(2026, 10, 15, 12, () => render({}));
  assert.strictEqual(countOf(text, 'came from the server clock'), 1);
  assert.ok(text.includes('from 2025-12-01 to 2026-11-30'));
  assert.ok(!withClock(2026, 10, 15, 12, () => render({ date: '2026-11-15' })).includes('server clock'));
});

await check('offer matrix through the real policy: compact, all and both read-only offer it; legacy does not', async () => {
  const offered = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(manager.getPublishedToolNames())).map((d) => d.name);
  };
  assert.ok((await offered({ surface: 'compact' })).includes('subscription_finder'));
  assert.ok((await offered({ surface: 'all' })).includes('subscription_finder'));
  assert.ok((await offered({ surface: 'compact', readOnly: true })).includes('subscription_finder'));
  assert.ok((await offered({ surface: 'all', readOnly: true })).includes('subscription_finder'));
  assert.ok(!(await offered({ surface: 'legacy' })).includes('subscription_finder'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
