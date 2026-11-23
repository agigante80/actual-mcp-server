// tests/unit/prompt_monthly_review.test.js
//
// #661: the monthly_review prompt: arguments, exact month boundaries, the default month, the
// read-only text and the offer matrix through the real tool policy.
//
// Run: node tests/unit/prompt_monthly_review.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-monthly-review]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'monthly_review');
const render = (args) => renderPrompt(def, args);
const THE_FOUR = ['get_context', 'list_budget_months', 'summarize_transactions', 'search_transactions'];
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);

await check('monthly_review is registered with its title and one optional month argument', () => {
  assert.ok(def, 'monthly_review must be in PROMPT_DEFINITIONS');
  assert.strictEqual(def.title, 'Monthly budget review');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.required]), [['month', false]]);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

await check('requiredTools is exactly the four read tools', () => {
  assert.deepStrictEqual(def.requiredTools, THE_FOUR);
});

await check('every compact tool name in the text is required; no manage_, no dash, no decimal dollars', () => {
  const text = render({ month: '2026-10' });
  const compact = [...manager.getCompactToolNames()];
  assert.ok(compact.length >= 15);
  const tokens = text.match(/[a-z_]+/g);
  for (const t of tokens) {
    if (compact.includes(t)) assert.ok(def.requiredTools.includes(t), `${t} is named but not required`);
  }
  for (const t of THE_FOUR) assert.ok(tokens.includes(t), `${t} should be named in the text`);
  assert.ok(!text.includes('manage_'), 'the prompt must stay read-only');
  assert.match(text, /stay read-only/);
  assert.ok(!EM_EN.test(text), 'no em or en dash');
  assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
});

await check('argsSchema refuses malformed months, hostile strings and unknown keys', () => {
  for (const month of ['October', '2026-00', '2026-13', ' 2026-10', '2026-10\n', 'x'.repeat(10000), '2026-1', '']) {
    assert.throws(() => def.argsSchema.parse({ month }), `must refuse ${JSON.stringify(month.slice(0, 12))}`);
  }
  assert.throws(() => def.argsSchema.parse({ month: '2026-10', extra: 'x' }), /extra/);
  assert.throws(() => def.argsSchema.parse({ month: 202610 }));
  assert.deepStrictEqual(def.argsSchema.parse({ month: '2026-10' }), { month: '2026-10' });
});

await check('render fills the exact first and last day', () => {
  const cases = [['2026-10', '2026-10-31'], ['2024-02', '2024-02-29'], ['2026-02', '2026-02-28'], ['2026-12', '2026-12-31'], ['2026-04', '2026-04-30']];
  for (const [month, last] of cases) {
    const text = render({ month });
    assert.ok(text.includes(`from ${month}-01 to ${last}.`), `${month}: ${text.split('\n')[0]}`);
    assert.ok(text.includes(`end_date ${last}`));
    assert.ok(!text.includes('{'), 'no unfilled placeholder');
  }
});

await check('no month: the schema default is the server current month, never "this month"', () => {
  const local = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const before = local();
  const text = render({});
  const after = local();
  assert.ok(text.includes(`${before}-01`) || text.includes(`${after}-01`), text.split('\n')[0]);
  assert.ok(!text.includes('this month'));
  assert.ok(!render(undefined).includes('this month'));
});

await check('offer matrix through the real policy: compact, all and compact read-only offer it; legacy does not', async () => {
  const offered = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(manager.getPublishedToolNames())).map((d) => d.name);
  };
  assert.ok((await offered({ surface: 'compact' })).includes('monthly_review'));
  assert.ok((await offered({ surface: 'all' })).includes('monthly_review'));
  assert.ok((await offered({ surface: 'compact', readOnly: true })).includes('monthly_review'));
  assert.ok(!(await offered({ surface: 'legacy' })).includes('monthly_review'));
});

// ---------------------------------------------------------------- #772
const { formatZodError } = await import('../../dist/src/lib/zod-error-format.js');
const messageOf = (args) => {
  try { render(args); } catch (err) { return formatZodError(err, def.argsSchema); }
  throw new Error(`expected a refusal for ${JSON.stringify(args)}`);
};
const occurrences = (s, sub) => s.split(sub).length - 1;
const NOISE = /pattern|at most|\^|\$/;
await check('an empty or blank month is the default; a bad month is one readable message (#772)', () => {
  const base = render({});
  assert.strictEqual(render({ month: '' }), base);
  assert.strictEqual(render({ month: '   ' }), base);
  assert.ok(render({ month: ' 2024-02 ' }).includes('2024-02-29'));
  for (const bad of ['October', '2026-13', '2026-1']) {
    const m = messageOf({ month: bad });
    assert.ok(m.includes('month: must be YYYY-MM'), m);
    assert.strictEqual(occurrences(m, 'must'), 1, m);
    assert.ok(!NOISE.test(m) && !m.includes(bad), m);
  }
  assert.throws(() => def.argsSchema.parse({ month: '' }));
});

// #781: a month the budget does not cover. list_budget_months with such a month throws, so the
// text lists the budget months first and says what to skip.
await check('monthly_review lists the budget months first and says what to skip for a month outside them (#781)', () => {
  const text = render({ month: '2026-10' });
  const para = 'Before step 1, call list_budget_months with no month to get the months the budget covers. If 2026-10 is not in that list, the budget has no data for it: do not call list_budget_months with 2026-10, say that the budget does not cover 2026-10, '  + 'and skip step 2 and the searches in step 4. Answer from step 3 alone: income, expenses and the savings rate, with no budgeted, overspent or unused-budget figures.';
  assert.ok(text.includes(para), 'the paragraph is missing or changed');
  assert.ok(text.indexOf(para) < text.indexOf('\n1. '), 'the paragraph comes before step 1');
  assert.ok(!text.includes('{'), 'no unfilled placeholder');
  assert.ok(!text.includes('this month'));
  assert.strictEqual(text.split(para).length - 1, 1, 'the paragraph appears exactly once');
});


// #774: the clock is stubbed from LOCAL components, which is what dates.ts reads, so the results
// do not depend on the day the test runs or on TZ.
const RealDate = Date;
function withClock(y, monthIndex, d, h, fn) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(y, monthIndex, d, h, 0, 0); }
    static now() { return new RealDate(y, monthIndex, d, h).getTime(); }
  };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
const countOf = (s, sub) => s.split(sub).length - 1;
const EMPTY_LINE = 'If a step returns no rows, say so plainly and carry on with what exists. Do not widen the date range on your own.';
const ZERO_LINE = 'If income is 0, say the savings rate cannot be computed instead of dividing by zero.';

await check('a defaulted month says it came from the server clock and is not over (#774)', () => {
  const text = withClock(2026, 9, 31, 23, () => render({}));
  assert.ok(text.includes('from 2026-10-01 to 2026-10-31.'), text.split('\n')[0]);
  assert.strictEqual(countOf(text, 'came from the server clock'), 1);
  assert.strictEqual(countOf(text, 'That month is not over'), 1);
  assert.ok(!text.includes('this month') && !text.includes('{'));
  assert.ok(withClock(2026, 9, 31, 23, () => render({ month: '' })).includes('came from the server clock'), 'a blank month is a default (#772)');
});

await check('a supplied month, even the current one, carries no origin clause (#774)', () => {
  for (const month of ['2026-09', '2026-10']) {
    const text = withClock(2026, 9, 31, 23, () => render({ month }));
    assert.ok(!text.includes('server clock') && !text.includes('not over'), month);
  }
});

await check('monthly_review: empty step, Uncategorized, zero income and count 1000 sentences (#774)', () => {
  const text = render({ month: '2026-10' });
  assert.strictEqual(countOf(text, EMPTY_LINE), 1);
  assert.ok(text.includes('Rows named Uncategorized have no category group'));
  assert.ok(text.includes('report their total on its own line'));
  assert.strictEqual(countOf(text, ZERO_LINE), 1);
  assert.ok(text.includes('if it equals 1000'));
  assert.ok(!text.includes('hasMore') && !text.includes('truncated'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
