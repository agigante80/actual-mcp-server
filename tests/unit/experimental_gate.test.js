// tests/unit/experimental_gate.test.js
//
// #840: MCP_EXPERIMENTAL, the publication gate for experimental upstream surfaces (ADR 0003,
// ADR 0004). The gate hides AND refuses a tool whose feature the operator did not name; it is
// a publication control, never an authorisation one.
//
// What this proves, and why each part exists:
//   - the resolver publishes the gated read tool only with the feature named, and hides it with
//     its OWN reason MCP_EXPERIMENTAL otherwise (not MCP_TOOLSETS: the compact MCP_TOOLS path
//     waives an MCP_TOOLSETS hide, which would let the compact action run with the feature off);
//   - MCP_TOOLSETS=all, the compact MCP_TOOLS path and MCP_READ_ONLY never override the gate;
//   - the startup refusals and both ToolUnavailableError texts are exact;
//   - with the variable unset the published tools list is byte-identical to the one before this
//     change, on the legacy, compact and all surfaces, and server_info reports no feature.
//
// Run: node tests/unit/experimental_gate.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE', 'MCP_EXPERIMENTAL']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[#840 experimental gate]');

const { z } = await import('zod');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const toolsets = await import('../../dist/src/lib/toolsets.js');
const { resolvePublishedToolNames, isOperationPublished, EXPERIMENTAL, experimentalFeatureOf } = toolsets;
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
const { outputJsonSchema } = await import('../../dist/src/lib/tool-output.js');

const GATED = 'actual_categories_get_automations';
// #841: the feature now gates the read tool and the two template writes.
const FEATURE_TOOLS = [GATED, 'actual_budgets_apply_templates', 'actual_budgets_run_cleanup'];
const FEATURE = 'budget_automations';
const ALL = { toolsets: 'all', tools: '', readOnly: false };

await manager.initialize(ALL);
const registered = manager.getToolNames();
const compactMeta = COMPACT_TOOLS.map((c) => ({ name: c.name, legacy: compactLegacyNames(c) }));
const resolve = (settings, meta = compactMeta) => resolvePublishedToolNames(registered, { ...ALL, ...settings }, meta);
const thrown = (fn) => { try { fn(); } catch (e) { return e; } return undefined; };

// ---- the table ----

await check('the EXPERIMENTAL table maps the feature to the gated read tool, and the registry holds the tool', () => {
  assert.deepStrictEqual(EXPERIMENTAL[FEATURE], FEATURE_TOOLS);
  assert.strictEqual(experimentalFeatureOf(GATED), FEATURE);
  assert.strictEqual(experimentalFeatureOf('actual_accounts_list'), undefined);
  assert.ok(registered.includes(GATED), 'the tool is registered (and so counted in IMPLEMENTED_TOOLS)');
});

// ---- the resolver ----

await check('POSITIVE: with the feature named the tool is published and nothing is hidden for MCP_EXPERIMENTAL', () => {
  const p = resolve({ experimental: FEATURE });
  assert.ok(p.published.includes(GATED));
  assert.ok(![...p.hidden.values()].includes('MCP_EXPERIMENTAL'));
  assert.deepStrictEqual([...p.settings.experimental], [FEATURE]);
});

await check('NEGATIVE: with the feature empty the tool is hidden for MCP_EXPERIMENTAL, and only the feature tools are', () => {
  const p = resolve({ experimental: '' });
  assert.ok(!p.published.includes(GATED));
  assert.strictEqual(p.hidden.get(GATED), 'MCP_EXPERIMENTAL');
  assert.deepStrictEqual([...p.hidden].filter(([, why]) => why === 'MCP_EXPERIMENTAL').map(([n]) => n).sort(), [...FEATURE_TOOLS].sort());
  assert.strictEqual(p.published.length, registered.length - FEATURE_TOOLS.length);
  assert.deepStrictEqual([...p.settings.experimental], []);
});

await check('NEGATIVE: an unset experimental setting behaves like an empty one', () => {
  assert.deepStrictEqual([...resolve({}).published], [...resolve({ experimental: '' }).published]);
});

await check('MCP_READ_ONLY with the feature enabled still publishes the read tool (it does not write)', () => {
  const p = resolve({ experimental: FEATURE, readOnly: true });
  assert.ok(p.published.includes(GATED));
  assert.ok(!toolsets.WRITE_CAPABLE.has(GATED));
});

await check('NEGATIVE: MCP_TOOLSETS=all does not select a gated tool (legacy surface)', () => {
  const p = resolve({ toolsets: 'all', surface: 'legacy' });
  assert.strictEqual(p.hidden.get(GATED), 'MCP_EXPERIMENTAL');
  assert.strictEqual(isOperationPublished(p, GATED), false);
});

await check('NEGATIVE: MCP_TOOLSETS=all does not select a gated tool (all surface)', () => {
  const p = resolve({ toolsets: 'all', surface: 'all' });
  assert.strictEqual(p.hidden.get(GATED), 'MCP_EXPERIMENTAL');
  assert.strictEqual(isOperationPublished(p, GATED), false);
});

await check('NEGATIVE: the compact MCP_TOOLS=list_entities path does not waive the gate', () => {
  const p = resolve({ surface: 'compact', tools: 'list_entities' });
  assert.ok(p.published.includes('list_entities'));
  assert.strictEqual(p.hidden.get(GATED), 'MCP_EXPERIMENTAL');
  assert.strictEqual(isOperationPublished(p, GATED), false);
});

await check('POSITIVE: the same compact path with the feature named is allowed through (per-operation rule)', () => {
  const p = resolve({ surface: 'compact', tools: 'list_entities', experimental: FEATURE });
  assert.strictEqual(isOperationPublished(p, GATED), true);
});

// ---- a compact tool whose only legacy tool is gated ----

const fixture = {
  name: 'fixture_automations',
  legacy: [GATED],
};

await check('NEGATIVE then POSITIVE: a compact tool whose only legacy tool is gated is unlisted off and listed on', () => {
  const off = resolve({ surface: 'compact' }, [...compactMeta, fixture]);
  assert.ok(!off.published.includes(fixture.name), 'unlisted with the feature off');
  const on = resolve({ surface: 'compact', experimental: FEATURE }, [...compactMeta, fixture]);
  assert.ok(on.published.includes(fixture.name), 'listed with the feature on');
});

await check('a compact tool with other published legacy tools stays listed with the feature off (no new compact hide rule)', () => {
  const p = resolve({ surface: 'compact' });
  assert.ok(p.published.includes('list_entities'));
  const q = resolve({ surface: 'all' });
  assert.ok(q.published.includes('list_entities'));
});

// ---- startup refusals ----

await check('NEGATIVE: an unknown feature name throws the exact message', () => {
  const err = thrown(() => resolve({ experimental: 'nope' }));
  assert.ok(err, 'must throw');
  assert.strictEqual(err.message, 'Unknown name in MCP_EXPERIMENTAL: "nope". Valid names: budget_automations');
});

await check('NEGATIVE: an unknown name next to a valid one still refuses, naming only the unknown one', () => {
  const err = thrown(() => resolve({ experimental: `${FEATURE}, nope` }));
  assert.ok(err && err.message.includes('"nope"') && !err.message.includes('"budget_automations"'), String(err?.message));
});

await check('NEGATIVE: MCP_TOOLS naming the gated tool with the feature off throws the exact message (legacy surface)', () => {
  const err = thrown(() => resolve({ surface: 'legacy', toolsets: 'query', tools: GATED }));
  assert.ok(err, 'must throw');
  assert.strictEqual(
    err.message,
    'MCP_TOOLS names "actual_categories_get_automations", which belongs to the experimental feature "budget_automations". Add it to MCP_EXPERIMENTAL to publish it.',
  );
});

await check('POSITIVE: MCP_TOOLS naming the gated tool with the feature on publishes it', () => {
  const p = resolve({ surface: 'legacy', toolsets: 'query', tools: GATED, experimental: FEATURE });
  assert.ok(p.published.includes(GATED));
});

await check('the config accepts the variable and defaults it to empty', async () => {
  const config = (await import('../../dist/src/config.js')).default;
  assert.strictEqual(config.MCP_EXPERIMENTAL, '');
});

// ---- the two refusal texts ----

await check('tool-scope ToolUnavailableError text is exact', () => {
  const err = new ToolUnavailableError(GATED, 'MCP_EXPERIMENTAL', 'legacy', 'tool', FEATURE);
  assert.strictEqual(
    err.message,
    'Tool "actual_categories_get_automations" is not available: it belongs to the experimental feature "budget_automations", which this server does not enable (MCP_EXPERIMENTAL).',
  );
  assert.strictEqual(err.setting, 'MCP_EXPERIMENTAL');
});

await check('action-scope ToolUnavailableError text is exact', () => {
  const err = new ToolUnavailableError('list_entities with type category_automations', 'MCP_EXPERIMENTAL', 'compact', 'action', FEATURE);
  assert.strictEqual(
    err.message,
    'Tool "list_entities with type category_automations" is not available: that action belongs to the experimental feature "budget_automations", which this server does not enable (MCP_EXPERIMENTAL).',
  );
});

// ---- dispatch ----

await check('NEGATIVE: a direct call to the gated tool with the feature off is refused naming MCP_EXPERIMENTAL', async () => {
  await manager.initialize({ ...ALL, surface: 'legacy' });
  const err = await manager.callToolChecked(GATED, { categoryId: '00000000-0000-4000-8000-000000000001' }).then(() => null, (e) => e);
  assert.ok(err instanceof ToolUnavailableError, `expected ToolUnavailableError, got ${err}`);
  assert.strictEqual(err.setting, 'MCP_EXPERIMENTAL');
  assert.strictEqual(
    err.message,
    'Tool "actual_categories_get_automations" is not available: it belongs to the experimental feature "budget_automations", which this server does not enable (MCP_EXPERIMENTAL).',
  );
});

await check('NEGATIVE: compact list_entities type category_automations with the feature off is refused with the exact text', async () => {
  await manager.initialize({ ...ALL, surface: 'compact' });
  const err = await manager.getTool('list_entities')
    .call({ type: 'category_automations', category_id: '00000000-0000-4000-8000-000000000001' })
    .then(() => null, (e) => e);
  assert.ok(err instanceof ToolUnavailableError, `expected ToolUnavailableError, got ${err}`);
  assert.strictEqual(err.setting, 'MCP_EXPERIMENTAL');
  assert.strictEqual(
    err.message,
    'Tool "list_entities with type category_automations" is not available: that action belongs to the experimental feature "budget_automations", which this server does not enable (MCP_EXPERIMENTAL). Enabled actions: account, account_group, category, category_group, payee, tag, rule, schedule, note, budget_file.',
  );
});

await check('POSITIVE: compact list_entities names category_automations (enum and description) only with the feature on', async () => {
  await manager.initialize({ ...ALL, surface: 'compact', experimental: FEATURE });
  const schema = z.toJSONSchema(manager.getTool('list_entities').inputSchema);
  assert.ok(schema.properties.type.enum.includes('category_automations'));
  assert.ok(manager.getTool('list_entities').description.includes('category_automations'));
  assert.ok('category_id' in schema.properties);
  await manager.initialize({ ...ALL, surface: 'compact' });
  const off = z.toJSONSchema(manager.getTool('list_entities').inputSchema);
  assert.ok(!off.properties.type.enum.includes('category_automations'));
  assert.ok(!manager.getTool('list_entities').description.includes('category_automations'));
  assert.ok(!('category_id' in off.properties), 'the new field is not published with the feature off');
});

await check('NEGATIVE: with the feature on, category_automations refuses an empty or missing category_id before any read', async () => {
  await manager.initialize({ ...ALL, surface: 'compact', experimental: FEATURE });
  const tool = manager.getTool('list_entities');
  const empty = await tool.call({ type: 'category_automations', category_id: '' }).then(() => null, (e) => e);
  assert.ok(empty !== null, 'an empty category_id must be refused');
  assert.match(String(empty.message), /category_id/, String(empty.message));
  const missing = await tool.call({ type: 'category_automations' }).then(() => null, (e) => e);
  assert.ok(missing !== null, 'a missing category_id must be refused');
  assert.match(String(missing.message), /category_id/, String(missing.message));
  await manager.initialize({ ...ALL, surface: 'compact' });
});

await check('NEGATIVE: getExperimentalFeatures() before initialize() fails closed naming initialize()', async () => {
  const fresh = (await import('../../dist/src/actualToolsManager.js?fresh-experimental')).default;
  assert.notStrictEqual(fresh, manager, 'the fresh import must be a distinct instance');
  assert.throws(
    () => fresh.getExperimentalFeatures(),
    { message: 'Tool publication policy is not resolved: actualToolsManager.initialize() has not run' },
  );
});

// ---- the default surface is byte-identical ----

// Measured on origin/develop ebe14145 (the commit before this change), with the same entry
// builder the server uses for tools/list.
// #841 re-measured compact and all: manage_budget_months carries nine actions with the feature on
// and the entry must stay under the 3,900 byte per-tool ceiling, so its older text was trimmed
// (compact 44852 to 44460, all 171909 to 171517). The legacy list is unchanged.
const DEFAULT_BYTES = { legacy: 127058, compact: 44460, all: 171517 };
const DEFAULT_COUNT = { legacy: 85, compact: 15, all: 100 };
const LIST_ENTITIES_DEFAULT_BYTES = 3900;

async function listEntries(surface, experimental) {
  await manager.initialize({ ...ALL, surface, ...(experimental ? { experimental } : {}) });
  const names = manager.getPublishedToolNames();
  return buildToolListEntries(names, (name) => {
    const tool = manager.getTool(name);
    const isCompact = COMPACT_TOOLS.some((c) => c.name === name);
    return {
      description: tool.description,
      schema: tool.inputSchema ? z.toJSONSchema(tool.inputSchema) : undefined,
      outputSchema: isCompact ? undefined : outputJsonSchema(tool),
    };
  });
}
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

for (const surface of ['legacy', 'compact', 'all']) {
  await check(`default configuration: the ${surface} tools list is byte-identical to the one before this change`, async () => {
    const entries = await listEntries(surface);
    assert.strictEqual(entries.length, DEFAULT_COUNT[surface]);
    assert.strictEqual(bytes(entries), DEFAULT_BYTES[surface]);
    assert.ok(!JSON.stringify(entries).includes('category_automations'));
    assert.ok(!JSON.stringify(entries).includes(GATED));
  });
}

await check('default configuration: the published list_entities entry is the same size as before (3,900 bytes)', async () => {
  const entries = await listEntries('compact');
  assert.strictEqual(bytes(entries.find((e) => e.name === 'list_entities')), LIST_ENTITIES_DEFAULT_BYTES);
});

await check('with the feature on, the legacy list gains exactly the feature tools and the compact list keeps its 15 tools', async () => {
  const legacy = await listEntries('legacy', FEATURE);
  assert.strictEqual(legacy.length, DEFAULT_COUNT.legacy + FEATURE_TOOLS.length);
  assert.ok(legacy.some((e) => e.name === GATED));
  const compact = await listEntries('compact', FEATURE);
  assert.strictEqual(compact.length, DEFAULT_COUNT.compact);
  assert.ok(bytes(compact.find((e) => e.name === 'list_entities')) <= 3900, 'list_entities stays under the per-tool ceiling with the feature on');
});

// ---- server_info ----

await check('server_info reports experimental: [] by default and the enabled names when set', async () => {
  const serverInfo = (await import('../../dist/src/tools/server_info.js')).default;
  await manager.initialize({ ...ALL });
  const off = await serverInfo.call({});
  const offBody = off.result ?? off;
  assert.deepStrictEqual(offBody.experimental, []);
  await manager.initialize({ ...ALL, experimental: FEATURE });
  const on = await serverInfo.call({});
  assert.deepStrictEqual((on.result ?? on).experimental, [FEATURE]);
  await manager.initialize({ ...ALL });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
