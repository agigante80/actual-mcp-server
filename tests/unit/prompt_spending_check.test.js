// tests/unit/prompt_spending_check.test.js
//
// #662: the spending_check prompt: the calendar-checked date argument, exact day math, the
// sign-safe overall budget wording, the default date and the offer matrix through the real policy.
//
// Run: node tests/unit/prompt_spending_check.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-spending-check]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { isCalendarDay } = await import('../../dist/src/prompts/dates.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'spending_check');
const render = (args) => renderPrompt(def, args);
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);

await check('spending_check is registered with its title and one optional date argument', () => {
  assert.ok(def, 'spending_check must be in PROMPT_DEFINITIONS');
  assert.strictEqual(def.title, 'Spending check');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.required]), [['date', false]]);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator (assertArgsBounded sees the default)', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

await check('requiredTools is exactly the two read tools; the text names only required compact tools', () => {
  assert.deepStrictEqual(def.requiredTools, ['list_budget_months', 'summarize_transactions']);
  const text = render({ date: '2026-10-15' });
  const compact = [...manager.getCompactToolNames()];
  const tokens = text.match(/[a-z_]+/g);
  for (const t of tokens) {
    if (compact.includes(t)) assert.ok(def.requiredTools.includes(t), `${t} is named but not required`);
  }
  for (const t of def.requiredTools) assert.ok(tokens.includes(t), `${t} should be named in the text`);
});

await check('the text is read-only and names totalBalance, a sign-safe overall budget, and nothing banned', () => {
  const text = render({ date: '2026-10-15' });
  assert.ok(!text.includes('manage_'), 'the prompt must stay read-only');
  assert.match(text, /stay read-only/i);
  assert.ok(!text.includes('toBudget'), 'toBudget is not what is left to spend');
  assert.ok(!text.includes('totalBudgeted'), 'totalBudgeted is negative in an envelope budget');
  assert.ok(!text.includes('this month'));
  assert.ok(text.includes('totalBalance'));
  assert.ok(text.includes('sum of budgeted over the expense categories'));
  assert.ok(!EM_EN.test(text), 'no em or en dash');
  assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
  assert.ok(!text.includes('{'), 'no unfilled placeholder');
});

await check('argsSchema refuses non-dates, non-calendar days, hostile strings and unknown keys', () => {
  const bad = ['2026-02-31', '2026-02-29', '2026-13-01', '2026-10-1', ' 2026-10-15', '2026-10-15\n',
    'SECRET-123', 'x'.repeat(10000), '', '2026-00-10', '2026-10-00'];
  for (const date of bad) {
    assert.throws(() => def.argsSchema.parse({ date }), `must refuse ${JSON.stringify(date.slice(0, 12))}`);
  }
  assert.throws(() => def.argsSchema.parse({ date: '2026-10-15', extra: 'x' }), /extra/);
  assert.throws(() => def.argsSchema.parse({ month: '2026-10' }), /month/);
  assert.throws(() => def.argsSchema.parse({ date: 20261015 }));
  assert.deepStrictEqual(def.argsSchema.parse({ date: '2026-10-15' }), { date: '2026-10-15' });
  assert.deepStrictEqual(def.argsSchema.parse({ date: '2024-02-29' }), { date: '2024-02-29' });
});

await check('a refused hostile value never throws anything but a validation error, and is not echoed', () => {
  try {
    def.argsSchema.parse({ date: 'SECRET-123' });
    assert.fail('must refuse');
  } catch (err) {
    assert.ok(Array.isArray(err.issues), `expected a ZodError, got ${err && err.constructor && err.constructor.name}`);
    assert.ok(!JSON.stringify(err.issues).includes('SECRET-123'), 'the value must not be echoed');
  }
});

await check('isCalendarDay never throws, for any input', () => {
  for (const v of [undefined, null, 5, {}, [], 'SECRET-123', '', '2026-02-31', '2026-10-15\n']) {
    assert.strictEqual(isCalendarDay(v), false);
  }
  assert.strictEqual(isCalendarDay('2024-02-29'), true);
  assert.strictEqual(isCalendarDay('2026-02-29'), false);
});

await check('render fills the exact day, days in month and first day', () => {
  const cases = [
    ['2026-10-15', 'for 2026-10, as of 2026-10-15: day 15 of 31', 'start_date 2026-10-01'],
    ['2024-02-29', 'day 29 of 29', 'start_date 2024-02-01'],
    ['2026-02-28', 'day 28 of 28', 'start_date 2026-02-01'],
    ['2026-12-31', 'day 31 of 31', 'start_date 2026-12-01'],
    ['2026-10-01', 'day 1 of 31', 'start_date 2026-10-01'],
    ['2026-04-09', 'day 9 of 30', 'end_date 2026-04-09'],
  ];
  for (const [date, a, b] of cases) {
    const text = render({ date });
    assert.ok(text.includes(a), `${date}: missing ${a}`);
    assert.ok(text.includes(b), `${date}: missing ${b}`);
  }
  assert.ok(render({ date: '2026-10-01' }).includes('On day 1 skip the pace check'));
  assert.ok(!render({ date: '2026-04-09' }).includes('day 09'), 'the day has no leading zero');
});

await check('no date: the schema default is the server local today, never "this month"', () => {
  const local = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const before = local();
  const text = render({});
  const after = local();
  assert.ok(text.includes(`as of ${before}`) || text.includes(`as of ${after}`), text.split('\n')[0]);
  assert.ok(!text.includes('this month'));
  assert.ok(!render(undefined).includes('this month'));
});

await check('offer matrix through the real policy: compact, all and compact read-only offer it; legacy does not', async () => {
  const offered = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(manager.getPublishedToolNames())).map((d) => d.name);
  };
  assert.ok((await offered({ surface: 'compact' })).includes('spending_check'));
  assert.ok((await offered({ surface: 'all' })).includes('spending_check'));
  assert.ok((await offered({ surface: 'compact', readOnly: true })).includes('spending_check'));
  assert.ok(!(await offered({ surface: 'legacy' })).includes('spending_check'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
