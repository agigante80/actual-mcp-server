// tests/unit/compact_manage_tags.test.js
//
// #676: the compact manage_tags tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_tags.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-tags]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_tags');
assert.ok(spec, 'manage_tags is registered');

const U1 = '123e4567-e89b-42d3-a456-426614174000';
const U2 = '223e4567-e89b-42d3-a456-426614174001';
const seen = [];
let reply = (n) => ({ from: n });
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return reply(n); } };
const phrases = legacyPhrases(COMPACT_TOOLS);
const tool = buildCompactTool(spec, ops, phrases);
const run = async (input) => { seen.length = 0; return tool.call(input); };
const refused = async (input, re) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  const text = [e.message, ...(e.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`)].join(' | ');
  if (re) assert.ok(re.test(text), `${re} vs ${text}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};
const expectCall = async (input, n, a) => {
  await run(input);
  assert.deepStrictEqual(seen, [{ n, a }], JSON.stringify(input));
};

// ---- one positive per action ----

await check('create forwards tag, color and description', async () => {
  await expectCall({ action: 'create', tag: 't', color: '#112233' }, 'actual_tags_create', { tag: 't', color: '#112233' });
  await expectCall({ action: 'create', tag: 't', description: 'd' }, 'actual_tags_create', { tag: 't', description: 'd' });
  await expectCall({ action: 'create', tag: 't' }, 'actual_tags_create', { tag: 't' });
});
await check('update forwards flat fields, no wrapper', async () => {
  await expectCall({ action: 'update', id: U1, description: 'd' }, 'actual_tags_update', { id: U1, description: 'd' });
  await expectCall({ action: 'update', id: U1, tag: 'n', color: '#000000', description: 'e' }, 'actual_tags_update', { id: U1, tag: 'n', color: '#000000', description: 'e' });
});
await check('delete forwards id', () => expectCall({ action: 'delete', id: U1 }, 'actual_tags_delete', { id: U1 }));
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ result: { success: true } });
  assert.deepStrictEqual(await run({ action: 'delete', id: U1 }), { result: { success: true } });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the three values', () => refused({ action: 'frobnicate' }, /action.*create.*update.*delete/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: create without tag is refused with tag: required for action: create', () =>
  refused({ action: 'create' }, /tag.*required for action: create/));
await check('NEGATIVE: delete or update without id is refused', async () => {
  await refused({ action: 'delete' }, /id.*required for action: delete/);
  await refused({ action: 'update', tag: 'x' }, /id.*required for action: update/);
});
await check('NEGATIVE: delete with color names color as valid only for create, update', () =>
  refused({ action: 'delete', id: U1, color: '#000000' }, /color.*not valid for action: delete; valid only for action: create, update/));
await check('NEGATIVE: create with id is refused', () => refused({ action: 'create', tag: 't', id: U1 }, /id.*not valid for action: create/));
await check('NEGATIVE: update with only id is refused with the legacy message and calls nothing', () =>
  refused({ action: 'update', id: U1 }, /At least one of tag, color, or description must be provided/));
await check('NEGATIVE: malformed id and empty tag are refused', async () => {
  await refused({ action: 'delete', id: 'nope' }, /Invalid tag ID format/);
  await refused({ action: 'update', id: 'nope', tag: 'x' }, /Invalid tag ID format/);
  await refused({ action: 'create', tag: '' }, /tag must not be empty/);
  await refused({ action: 'update', id: U1, tag: '' }, /tag must not be empty/);
});
await check('NEGATIVE: null is refused for every field', async () => {
  await refused({ action: 'create', tag: 't', color: null }, /color/);
  await refused({ action: 'update', id: U1, description: null }, /description/);
});

// ---- read-only, published shape, metadata ----

await check('read-only: manage_tags is not listed, and a valid call is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_tags'));
  const legacy = manager.getTool('actual_tags_delete');
  const original = legacy.call;
  let ran = 0;
  legacy.call = async () => { ran++; return { success: true }; };
  try {
    let e;
    try { await manager.callTool('manage_tags', { action: 'delete', id: U1 }); } catch (x) { e = x; }
    assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', String(e));
    assert.strictEqual(ran, 0);
  } finally { legacy.call = original; }
});

await check('published schema: flat, action required, no oneOf or anyOf, every property typed and described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.strictEqual(js.oneOf, undefined);
  assert.strictEqual(js.anyOf, undefined);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js.properties)), 'no oneOf or anyOf in any property');
  assert.deepStrictEqual(js.required, ['action']);
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'update', 'delete']);
  assert.deepStrictEqual(Object.keys(js.properties).sort(), ['action', 'color', 'description', 'id', 'tag']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, DESTRUCTIVE, no legacy name', () => {
  for (const w of ['Returns', 'list_entities', 'create:', 'update:', 'delete:', 'DESTRUCTIVE']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('published entry stays under the per-tool ceiling (3900 bytes)', () => {
  const size = Buffer.byteLength(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));
  assert.ok(size < 3900, String(size));
});
await check('annotations: destructive write tool, not open-world, hints only', () => {
  assert.deepStrictEqual(annotationsFor('manage_tags'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
});
await check('compactLegacyNames covers the targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_tags_create', 'actual_tags_delete', 'actual_tags_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});

console.log(`\n[compact-manage-tags] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
