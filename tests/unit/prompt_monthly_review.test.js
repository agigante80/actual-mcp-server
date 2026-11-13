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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
