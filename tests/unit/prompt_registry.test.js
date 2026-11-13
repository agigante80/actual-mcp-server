// tests/unit/prompt_registry.test.js
//
// #660: the pure prompt registry functions and validators, fed bad fixtures so each guard can
// fail, plus the offer matrix driven through the REAL tool policy (actualToolsManager).
//
// Run: node tests/unit/prompt_registry.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-registry]');

const { z, ZodError } = await import('zod');
const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = (over = {}) => ({
  name: 'monthly_review',
  title: 'Monthly review',
  description: 'd',
  arguments: [{ name: 'month', description: 'YYYY-MM', required: true }],
  requiredTools: ['get_context'],
  argsSchema: z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
  render: (a) => `Review ${a.month}`,
  ...over,
});

// ---------------------------------------------------------------- resolveOfferedPrompts
await check('a prompt is offered when every required tool is published', () => {
  const out = resolveOfferedPrompts([def({ requiredTools: ['a', 'b'] })], new Set(['a', 'b', 'c']));
  assert.deepStrictEqual(out.map((d) => d.name), ['monthly_review']);
});
await check('a prompt is dropped when one required tool is missing', () => {
  assert.deepStrictEqual(resolveOfferedPrompts([def({ requiredTools: ['a', 'b'] })], new Set(['a'])), []);
});
await check('registry order is kept', () => {
  const out = resolveOfferedPrompts([def({ name: 'b_one', requiredTools: [] }), def({ name: 'a_two', requiredTools: [] })], new Set());
  assert.deepStrictEqual(out.map((d) => d.name), ['b_one', 'a_two']);
});

// ---------------------------------------------------------------- surface matrix (real policy)
const C = def({ name: 'compact_prompt', requiredTools: ['get_context', 'manage_transactions'] });
const L = def({ name: 'legacy_prompt', requiredTools: ['actual_accounts_list'] });
async function offeredFor(settings) {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
  return resolveOfferedPrompts([C, L], new Set(manager.getPublishedToolNames())).map((d) => d.name);
}
await check('surface matrix: legacy offers only the legacy prompt', async () => {
  assert.deepStrictEqual(await offeredFor({ surface: 'legacy' }), ['legacy_prompt']);
});
await check('surface matrix: compact offers only the compact prompt', async () => {
  assert.deepStrictEqual(await offeredFor({ surface: 'compact' }), ['compact_prompt']);
});
await check('surface matrix: all offers both', async () => {
  assert.deepStrictEqual(await offeredFor({ surface: 'all' }), ['compact_prompt', 'legacy_prompt']);
});
await check('surface matrix: compact read-only offers neither (manage_transactions is hidden whole)', async () => {
  assert.deepStrictEqual(await offeredFor({ surface: 'compact', readOnly: true }), []);
});

await check('published vs unpublished set: the manage_* prompt is absent under compact read-only and present under compact', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  const published = new Set(manager.getPublishedToolNames());
  assert.ok(!published.has('manage_transactions'));
  assert.deepStrictEqual(resolveOfferedPrompts([C], published), []);
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'compact' }, COMPACT_TOOLS);
  assert.deepStrictEqual(resolveOfferedPrompts([C], new Set(manager.getPublishedToolNames())).map((d) => d.name), ['compact_prompt']);
});

// ---------------------------------------------------------------- assertPromptNames
await check('assertPromptNames accepts a snake_case name', () => {
  assertPromptNames([def()]);
});
await check('assertPromptNames rejects camelCase', () => {
  assert.throws(() => assertPromptNames([def({ name: 'showLargeTransactions' })]), /showLargeTransactions/);
});
await check('assertPromptNames rejects kebab-case', () => {
  assert.throws(() => assertPromptNames([def({ name: 'spending-check' })]), /spending-check/);
});
await check('assertPromptNames rejects a duplicate', () => {
  assert.throws(() => assertPromptNames([def(), def()]), /Duplicate prompt name "monthly_review"/);
});
await check('the real PROMPT_DEFINITIONS pass every validator', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

// ---------------------------------------------------------------- assertRequiredToolsKnown
await check('assertRequiredToolsKnown accepts known compact and legacy names', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assert.ok(known.has('get_context') && known.has('actual_accounts_list'));
  assertRequiredToolsKnown([def({ requiredTools: ['get_context', 'actual_accounts_list'] })], known);
});
await check('assertRequiredToolsKnown rejects an unknown tool, naming it', () => {
  assert.throws(
    () => assertRequiredToolsKnown([def({ requiredTools: ['no_such_tool'] })], new Set(['get_context'])),
    /no_such_tool/,
  );
});

// ---------------------------------------------------------------- assertArgsBounded
await check('assertArgsBounded accepts max, regex, enum and number arguments', () => {
  assertArgsBounded([def({ argsSchema: z.strictObject({
    a: z.string().max(7),
    b: z.string().regex(/^\d{4}-\d{2}$/),
    c: z.enum(['x', 'y']).default('x'),
    d: z.string().max(3).optional().default('abc'),
    e: z.coerce.number().int().min(1).max(12),
  }) })]);
});
await check('assertArgsBounded rejects an unbounded string, naming prompt and argument', () => {
  assert.throws(
    () => assertArgsBounded([def({ argsSchema: z.strictObject({ note: z.string() }) })]),
    /monthly_review.*note/,
  );
});
await check('assertArgsBounded rejects a union with an unbounded string option', () => {
  assert.throws(() => assertArgsBounded([def({ argsSchema: z.strictObject({ f: z.union([z.string(), z.literal('all')]) }) })]), /unbounded/);
});
await check('assertArgsBounded rejects string.or(number)', () => {
  assert.throws(() => assertArgsBounded([def({ argsSchema: z.strictObject({ f: z.string().or(z.number()) }) })]), /unbounded/);
});
await check('assertArgsBounded rejects a lazy string', () => {
  assert.throws(() => assertArgsBounded([def({ argsSchema: z.strictObject({ f: z.lazy(() => z.string()) }) })]), /unbounded/);
});
await check('assertArgsBounded fails closed on an unrecognised node type', () => {
  assert.throws(() => assertArgsBounded([def({ argsSchema: z.strictObject({ f: z.any() }) })]), /unbounded/);
});
await check('assertArgsBounded accepts a bounded string under a union and under default wrappers', () => {
  assertArgsBounded([def({ argsSchema: z.strictObject({
    a: z.string().regex(/^#[0-9a-f]{6}$/).max(7).default('#000000'),
    b: z.union([z.string().max(5), z.literal('all')]),
    c: z.string().max(5).nullable().optional(),
    d: z.boolean().default(false),
  }) })]);
});
await check('assertArgsBounded sees through optional, default and pipe wrappers', () => {
  for (const f of [z.string().optional(), z.string().default('x'), z.string().transform((s) => s), z.array(z.string())]) {
    assert.throws(() => assertArgsBounded([def({ argsSchema: z.strictObject({ f }) })]), /unbounded/);
  }
});

// ---------------------------------------------------------------- renderPrompt
await check('renderPrompt renders valid arguments', () => {
  assert.strictEqual(renderPrompt(def(), { month: '2026-10' }), 'Review 2026-10');
});
await check('renderPrompt throws a ZodError on a missing required argument', () => {
  assert.throws(() => renderPrompt(def(), undefined), ZodError);
});
await check('renderPrompt throws a ZodError on a malformed value and on an unknown key', () => {
  assert.throws(() => renderPrompt(def(), { month: 'October' }), ZodError);
  assert.throws(() => renderPrompt(def(), { month: '2026-10', extra: 'x' }), ZodError);
});

console.log(`\n[prompt-registry] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
