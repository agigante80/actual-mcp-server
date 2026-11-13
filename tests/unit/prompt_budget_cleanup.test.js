// tests/unit/prompt_budget_cleanup.test.js
//
// #664: the budget_cleanup prompt: the shared calendar-checked date argument, the exact six month
// window, the no-write sentence, the manage_ allow-set and the offer matrix.
//
// Run: node tests/unit/prompt_budget_cleanup.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-budget-cleanup]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'budget_cleanup');
const render = (args) => renderPrompt(def, args);
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const MANAGE_ALLOWED = ['manage_payees', 'manage_rules', 'manage_categories', 'manage_accounts'];
const SENTENCE = 'Do not call any manage_ tool in this turn.';

await check('budget_cleanup is registered with its title and one optional date argument', () => {
  assert.ok(def, 'budget_cleanup must be in PROMPT_DEFINITIONS');
  assert.strictEqual(def.title, 'Budget cleanup');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.required]), [['date', false]]);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

await check('requiredTools is exact; every compact tool named is required or an allowed manage_ proposal', () => {
  assert.deepStrictEqual(def.requiredTools, ['list_entities', 'summarize_transactions', 'list_budget_months']);
  const text = render({ date: '2026-11-13' });
  const compact = [...manager.getCompactToolNames()];
  for (const t of MANAGE_ALLOWED) assert.ok(compact.includes(t), `${t} must be a real compact tool`);
  const tokens = text.match(/[a-z_]+/g);
  for (const t of tokens) {
    if (compact.includes(t)) {
      assert.ok(def.requiredTools.includes(t) || MANAGE_ALLOWED.includes(t), `${t} is named but neither required nor allowed`);
    }
  }
  for (const t of def.requiredTools) assert.ok(tokens.includes(t), `${t} should be named in the text`);
});

await check('the text forbids any write in the turn, and has no dash, decimal dollar or placeholder', () => {
  const text = render({ date: '2026-11-13' });
  assert.ok(text.includes(SENTENCE), 'the exact no-write sentence must be present');
  assert.match(text, /analysis only/);
  assert.match(text, /Never propose deleting a category that still holds a balance/);
  assert.ok(!EM_EN.test(text), 'no em or en dash');
  assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
  assert.ok(!/\{[a-z_]+\}/.test(text), 'no unfilled placeholder');
});

await check('the safeguards are pinned: removing the sentence or the funded-category rule would be caught', () => {
  const text = render({ date: '2026-11-13' });
  assert.strictEqual(text.replace(SENTENCE, '').includes(SENTENCE), false);
  const stripped = text.replace('Never propose deleting a category that still holds a balance. ', '');
  assert.ok(!/Never propose deleting a category that still holds a balance/.test(stripped));
});

await check('date: accepts real days; refuses impossible, malformed and hostile values; unknown keys', () => {
  for (const date of ['2026-11-13', '2024-02-29']) assert.deepStrictEqual(def.argsSchema.parse({ date }), { date });
  const bad = ['2026-02-29', '2026-02-31', '2026-13-01', '2026-11-1', ' 2026-11-13', '2026-11-13\n',
    'x'.repeat(10000), 20261113, 'Jan-SECRET-123'];
  for (const date of bad) assert.throws(() => def.argsSchema.parse({ date }), `must refuse ${JSON.stringify(String(date).slice(0, 12))}`);
  try {
    def.argsSchema.parse({ date: 'Jan-SECRET-123' });
    assert.fail('must refuse');
  } catch (err) {
    assert.ok(Array.isArray(err.issues), 'a ZodError, never an internal error');
    assert.ok(!JSON.stringify(err.issues).includes('SECRET-123'), 'the value must not be echoed');
  }
  try {
    def.argsSchema.parse({ dryRun: 'zzSENTINELzz' });
    assert.fail('must refuse');
  } catch (err) {
    assert.ok(JSON.stringify(err.issues).includes('dryRun'));
    assert.ok(!JSON.stringify(err.issues).includes('SENTINEL'));
  }
});

await check('render fills the exact six month window', () => {
  const cases = [
    ['2026-11-13', '2026-05-01', '2026-11'],
    ['2026-01-15', '2025-07-01', '2026-01'],
    ['2026-06-30', '2025-12-01', '2026-06'],
    ['2026-07-01', '2026-01-01', '2026-07'],
    ['2024-08-31', '2024-02-01', '2024-08'],
  ];
  for (const [date, start, month] of cases) {
    const text = render({ date });
    assert.ok(text.includes(`as of ${date}`), date);
    assert.ok(text.includes(`from ${start} to ${date}.`), `${date}: expected from ${start}`);
    assert.ok(text.includes(`list_budget_months with month ${month}.`), `${date}: month ${month}`);
  }
});

await check('no date: the schema default is the server local today', () => {
  const local = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const before = local();
  const text = render({});
  const after = local();
  assert.ok(text.includes(`as of ${before}`) || text.includes(`as of ${after}`), text.split('\n')[0]);
});

await check('offer matrix through the real policy: compact, all and both read-only offer it; legacy does not', async () => {
  const offered = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(manager.getPublishedToolNames())).map((d) => d.name);
  };
  assert.ok((await offered({ surface: 'compact' })).includes('budget_cleanup'));
  assert.ok((await offered({ surface: 'all' })).includes('budget_cleanup'));
  assert.ok((await offered({ surface: 'compact', readOnly: true })).includes('budget_cleanup'));
  assert.ok((await offered({ surface: 'all', readOnly: true })).includes('budget_cleanup'));
  assert.ok(!(await offered({ surface: 'legacy' })).includes('budget_cleanup'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
