// tests/unit/prompt_categorize_uncategorized.test.js
//
// #665: the categorize_uncategorized prompt: the optional calendar-checked `since`, exact
// substitution, the confirm-before-write safeguards, and the offer matrix (write tools required).
//
// Run: node tests/unit/prompt_categorize_uncategorized.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-categorize-uncategorized]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'categorize_uncategorized');
const render = (args) => renderPrompt(def, args);
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const REQUIRED = ['list_entities', 'search_transactions', 'summarize_transactions', 'manage_transactions', 'manage_rules'];
const SAFEGUARDS = [
  'Wait for my answer',
  'ONE call to manage_transactions with action update_batch',
  'Create a rule only if I say yes',
];
const issuesOf = (fn) => { try { fn(); } catch (err) { return JSON.stringify(err.issues ?? err.message); } assert.fail('must refuse'); };

await check('registered with its title, description and one optional since argument', () => {
  assert.ok(def, 'categorize_uncategorized must be in PROMPT_DEFINITIONS');
  assert.strictEqual(def.title, 'Categorise uncategorised transactions');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.required]), [['since', false]]);
  assert.deepStrictEqual(def.requiredTools, REQUIRED);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

await check('every compact tool named in the text is required; no dash and no unfilled placeholder', () => {
  const compact = [...manager.getCompactToolNames()];
  for (const args of [{}, { since: '2026-10-01' }]) {
    const text = render(args);
    const tokens = text.match(/[a-z_]+/g);
    for (const t of tokens) {
      if (compact.includes(t)) assert.ok(REQUIRED.includes(t), `${t} is named but not in requiredTools`);
    }
    for (const t of REQUIRED) assert.ok(tokens.includes(t), `${t} should be named`);
    assert.ok(!EM_EN.test(text), 'no em or en dash');
    assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
    assert.ok(!/\{[a-z_]+\}/.test(text), 'no unfilled placeholder');
  }
});

await check('since: accepts real days; refuses impossible, malformed and hostile values; unknown keys', () => {
  for (const since of ['2026-10-01', '2024-02-29']) assert.deepStrictEqual(def.argsSchema.parse({ since }), { since });
  assert.deepStrictEqual(def.argsSchema.parse({}), {}, 'no default: omitted stays omitted');
  const bad = ['2026-02-30', '2026-02-29', '2026-13-01', '2026-10-1', ' 2026-10-01', '2026-10-01\n', '',
    20261001, 'x'.repeat(10000), 'zzSENTINELzz'];
  for (const since of bad) assert.throws(() => def.argsSchema.parse({ since }), `must refuse ${JSON.stringify(String(since).slice(0, 12))}`);
  const msg = issuesOf(() => def.argsSchema.parse({ since: 'zzSENTINELzz' }));
  assert.ok(msg.includes('since') && !msg.includes('SENTINEL'), 'names since, never echoes the value');
  const extra = issuesOf(() => def.argsSchema.parse({ since: '2026-10-01', extra: 'x' }));
  assert.ok(extra.includes('extra'));
  const month = issuesOf(() => def.argsSchema.parse({ month: '2026-10' }));
  assert.ok(month.includes('month'));
});

await check('render with since fills both placeholders exactly', () => {
  const text = render({ since: '2026-10-01' });
  assert.ok(text.includes('uncategorised transactions since 2026-10-01.'));
  assert.strictEqual(text.split(', start_date 2026-10-01').length - 1, 2, 'start_date twice');
  assert.ok(text.includes('limit 50, start_date 2026-10-01. If totalCount'));
});

await check('render without since leaves no since clause or argument', () => {
  const text = render({});
  assert.ok(text.includes('uncategorised transactions. Follow'));
  assert.ok(text.includes('include_transactions true and limit 50. If'));
  assert.ok(text.includes('by uncategorized again'));
  assert.ok(!/\bsince\b/.test(text), 'no since anywhere');
  assert.ok(!text.includes('{since'));
});

await check('safeguards are present and removing each one is detected', () => {
  const text = render({});
  for (const phrase of SAFEGUARDS) {
    assert.ok(text.includes(phrase), `missing: ${phrase}`);
    assert.ok(!text.replace(phrase, '').includes(phrase), `a mutated text must fail the check for: ${phrase}`);
  }
});

await check('offer matrix: compact and all offer it; legacy and read-only do not; a missing write tool drops it', async () => {
  const published = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return new Set(manager.getPublishedToolNames());
  };
  const names = (set) => resolveOfferedPrompts(PROMPT_DEFINITIONS, set).map((d) => d.name);
  assert.ok(names(await published({ surface: 'compact' })).includes('categorize_uncategorized'));
  assert.ok(names(await published({ surface: 'all' })).includes('categorize_uncategorized'));
  assert.ok(!names(await published({ surface: 'legacy' })).includes('categorize_uncategorized'));
  assert.ok(!names(await published({ surface: 'compact', readOnly: true })).includes('categorize_uncategorized'));
  const all = await published({ surface: 'compact' });
  all.delete('manage_rules');
  assert.ok(!names(all).includes('categorize_uncategorized'), 'without manage_rules it is not offered');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
