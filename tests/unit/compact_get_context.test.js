// tests/unit/compact_get_context.test.js
//
// #672: the compact get_context tool. A stubbed callOperation records the exact legacy tool
// name and arguments each call produces, so a wrong route, a wrong rename or a forwarded
// compact-only key fails here, and a refusal is proven to call nothing.
//
// Run: node tests/unit/compact_get_context.test.js   (needs `npm run build` first)

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
console.log('\n[compact-get-context]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');
const { resolvePublishedToolNames, WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');

const spec = COMPACT_TOOLS.find((t) => t.name === 'get_context');
assert.ok(spec, 'get_context is registered');

const seen = [];
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return { from: n }; } };
const phrases = legacyPhrases(COMPACT_TOOLS);
const tool = buildCompactTool(spec, ops, phrases);
const run = async (input) => { seen.length = 0; return tool.call(input); };
const refused = async (input, re) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  if (re) assert.ok(re.test(e.message) || (e.issues ?? []).some((i) => re.test(`${i.path.join('.')}: ${i.message}`)), `${re} vs ${e.message}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};

// ---- positives: one per topic ----

await check('no argument defaults to topic structure', async () => {
  await run({});
  assert.deepStrictEqual(seen, [{ n: 'actual_get_context', a: {} }]);
});
await check('topic structure with every option renames to the legacy camelCase keys', async () => {
  await run({ topic: 'structure', include_accounts: true, include_categories: false, include_payees: true, include_closed: true, payee_limit: 50 });
  assert.deepStrictEqual(seen, [{ n: 'actual_get_context', a: { includeAccounts: true, includeCategories: false, includePayees: true, includeClosed: true, payeeLimit: 50 } }]);
});
await check('topic server calls actual_server_info with no arguments', async () => {
  await run({ topic: 'server' });
  assert.deepStrictEqual(seen, [{ n: 'actual_server_info', a: {} }]);
});
await check('topic version calls actual_server_get_version with no arguments', async () => {
  await run({ topic: 'version' });
  assert.deepStrictEqual(seen, [{ n: 'actual_server_get_version', a: {} }]);
});
await check('topic preferences calls actual_preferences_get with no arguments', async () => {
  await run({ topic: 'preferences' });
  assert.deepStrictEqual(seen, [{ n: 'actual_preferences_get', a: {} }]);
});
await check('exactly one callOperation per compact call, and the legacy value is returned unwrapped', async () => {
  const r = await run({ topic: 'server' });
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(r, { from: 'actual_server_info' });
});

// ---- negatives ----

await check('NEGATIVE: unknown topic is refused', () => refused({ topic: 'everything' }));
await check('NEGATIVE: prototype-ish topic is refused', () => refused({ topic: 'constructor' }));
await check('NEGATIVE: an option on a topic that does not take it is refused naming the field', async () => {
  await refused({ topic: 'server', include_accounts: true }, /include_accounts/);
  await refused({ topic: 'version', payee_limit: 5 }, /payee_limit/);
  await refused({ topic: 'preferences', include_closed: true }, /include_closed/);
});
await check('NEGATIVE: an option with no topic (structure by default) that is unknown is refused', () => refused({ sort: 'frequency' }, /sort/));
await check('NEGATIVE: all three include flags false is refused', () =>
  refused({ include_accounts: false, include_categories: false, include_payees: false }, /cannot all be false/));
await check('two include flags false is accepted (only the all-false case is refused)', async () => {
  await run({ include_accounts: false, include_categories: false });
  assert.strictEqual(seen.length, 1);
});
await check('NEGATIVE: payee_limit out of range or fractional, and a non-boolean flag, are refused', async () => {
  await refused({ payee_limit: 0 });
  await refused({ payee_limit: 2001 });
  await refused({ payee_limit: 1.5 });
  await refused({ include_closed: 'yes' });
});
await check('NEGATIVE: an unknown key is refused', () => refused({ bogus: 1 }, /bogus/));

// ---- published shape ----

await check('published schema: no oneOf/anyOf, no outputSchema, every property described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js)));
  assert.strictEqual(tool.outputSchema, undefined);
  for (const [k, v] of Object.entries(js.properties)) if (k !== 'topic') assert.ok(v.description, `${k} has no description`);
  assert.ok(js.properties.topic.enum.includes('structure') && !js.required);
});
await check('description states read-only, a Returns sentence, every topic and the sibling tool', () => {
  for (const w of ['Read-only', 'Returns', 'structure', 'server', 'version', 'preferences', 'list_entities']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description), 'no legacy name in the description');
});
await check('annotations: read-only and no target is write-capable', () => {
  assert.strictEqual(annotationsFor('get_context').readOnlyHint, true);
  for (const r of spec.actions.values()) assert.ok(!WRITE_CAPABLE.has(r.legacy), r.legacy);
});

// ---- 4b rewrite ----

await check('4b: a legacy tool name in an error is rewritten to the compact phrase, class kept', async () => {
  const boom = new Error('failed in actual_server_info');
  const t = buildCompactTool(spec, { callOperation: async () => { throw boom; } }, phrases);
  const e = await t.call({ topic: 'server' }).catch((x) => x);
  assert.strictEqual(e, boom);
  assert.ok(!/actual_/.test(e.message) && /get_context with topic server/.test(e.message), e.message);
});

// ---- publication under the real manager ----

await check('publication: compact surface publishes both tools, including under MCP_READ_ONLY', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
  const names = manager.getToolNames();
  const meta = COMPACT_TOOLS.map((c) => ({ name: c.name, legacy: c.actions ? [...c.actions.values()].flatMap((r) => [r.legacy, ...(r.routes ?? []).map((x) => x.legacy)]) : [] }));
  const ro = resolvePublishedToolNames(names, { toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, meta);
  assert.deepStrictEqual([...ro.published], ['get_context', 'list_entities', 'search_transactions', 'summarize_transactions', 'list_budget_months', 'run_query']);  // manage_transactions writes, so read-only hides it (#675)
  const legacy = resolvePublishedToolNames(names, { toolsets: 'all', tools: '', readOnly: false, surface: 'legacy' }, meta);
  assert.ok(!legacy.published.includes('get_context'), 'hidden on the legacy surface');
  assert.strictEqual(legacy.published.length, 85);
});

console.log(`\n[compact-get-context] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
