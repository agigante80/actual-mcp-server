// tests/unit/compact_dispatch.test.js
//
// #671: MCP_TOOL_SURFACE, the compact registry, the dispatcher and callOperation.
//
// The registry ships EMPTY, so every case builds its own compact spec over real legacy tool
// names and stubs the legacy tools' `call`, which means nothing here reaches the adapter.
//
// What this proves, and why each part exists:
//   - the resolver publishes the right list per surface and hides the rest for the right
//     reason, including the read-only rule for a compact tool that can write;
//   - the dispatcher validates strictly, renames, wraps, and refuses an unknown action
//     (including prototype names) before anything is called;
//   - callOperation skips ONLY the hide MCP_TOOL_SURFACE=compact causes: MCP_READ_ONLY and
//     MCP_TOOLSETS still refuse, by the same typed error a direct call gets;
//   - the compact layer stays out of the adapter, and initialize() can run again.
//
// Run: node tests/unit/compact_dispatch.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

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

console.log('\n[compact-dispatch]');

const { z } = await import('zod');
const { resolvePublishedToolNames, WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const { dispatchCompact, buildCompactTool } = await import('../../dist/src/compact/dispatch.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const LIST = 'actual_accounts_list'; // reader
const UPDATE = 'actual_accounts_update'; // writer
assert.ok(!WRITE_CAPABLE.has(LIST) && WRITE_CAPABLE.has(UPDATE), 'fixture assumption: reader and writer');

const spec = {
  name: 'actual_fixture_accounts',
  description: 'Fixture compact tool for tests.',
  actions: new Map([
    ['list', { legacy: LIST, fields: z.object({}) }],
    [
      'update',
      {
        legacy: UPDATE,
        fields: z.object({ id: z.string(), name: z.string().optional(), offbudget: z.boolean().optional() }),
        rename: { offbudget: 'off_budget' },
        wrap: { into: 'fields', top: ['id'] },
      },
    ],
  ]),
};
const readerOnly = {
  name: 'actual_fixture_reader',
  description: 'Fixture compact tool that cannot write.',
  actions: new Map([['list', { legacy: LIST, fields: z.object({}) }]]),
};
const withDefault = { ...readerOnly, name: 'actual_fixture_default', defaultAction: 'list' };

const ALL = { toolsets: 'all', tools: '', readOnly: false };
await manager.initialize(ALL);
const legacyNames = manager.getToolNames();

// Stub the legacy tools' call; every stub records what it was handed.
const calls = [];
const originals = new Map();
for (const n of [LIST, UPDATE]) {
  const t = manager.getTool(n);
  originals.set(n, t.call);
  t.call = async (args) => { calls.push({ n, args }); return { result: { echoed: n } }; };
}
const restore = () => { for (const [n, fn] of originals) manager.getTool(n).call = fn; };
const init = (settings, specs = [spec]) => manager.initialize({ ...ALL, ...settings }, specs);

const resolveWith = (settings, compact = [spec]) =>
  resolvePublishedToolNames(legacyNames, { ...ALL, ...settings }, compact.map((c) => ({ name: c.name, legacy: [...c.actions.values()].map((r) => r.legacy) })));

const reason = async (fn) => { try { await fn(); } catch (e) { return e; } return undefined; };

// ---- resolver ----

await check('legacy surface (default): compact hidden for MCP_TOOL_SURFACE, legacy list unchanged', () => {
  const p = resolveWith({});
  assert.deepStrictEqual([...p.published], legacyNames);
  assert.strictEqual(p.hidden.get(spec.name), 'MCP_TOOL_SURFACE');
  assert.strictEqual(p.registered, legacyNames.length + 1);
  assert.strictEqual(p.settings.surface, 'legacy');
});

await check('compact surface: only the compact tool published, every legacy tool hidden for MCP_TOOL_SURFACE', () => {
  const p = resolveWith({ surface: 'compact' });
  assert.deepStrictEqual([...p.published], [spec.name]);
  for (const n of legacyNames) assert.strictEqual(p.hidden.get(n), 'MCP_TOOL_SURFACE', n);
});

await check('all surface: legacy first, then compact', () => {
  const p = resolveWith({ surface: 'all' });
  assert.deepStrictEqual([...p.published], [...legacyNames, spec.name]);
});

await check('all surface: MCP_TOOLSETS narrows the legacy names and never hides a compact tool', () => {
  const p = resolveWith({ surface: 'all', toolsets: 'query' });
  assert.ok(p.published.includes(spec.name));
  assert.ok(p.published.length < legacyNames.length);
});

await check('read-only: a compact tool with a writing action is hidden for MCP_READ_ONLY, a reader-only one stays', () => {
  const p = resolveWith({ surface: 'compact', readOnly: true }, [spec, readerOnly]);
  assert.strictEqual(p.hidden.get(spec.name), 'MCP_READ_ONLY');
  assert.deepStrictEqual([...p.published], [readerOnly.name]);
});

await check('NEGATIVE: compact surface with an empty registry publishes nothing and throws', () => {
  assert.throws(() => resolveWith({ surface: 'compact' }, []), /No tools would be published/);
});

await check('NEGATIVE: compact surface where read-only hides every compact tool throws', () => {
  assert.throws(() => resolveWith({ surface: 'compact', readOnly: true }, [spec]), /No tools would be published/);
});

await check('NEGATIVE: a compact tool named like a legacy tool is refused', () => {
  assert.throws(() => resolveWith({}, [{ ...readerOnly, name: LIST }]), /collides/);
});

// ---- manager: initialize ----

await check('initialize registers compact tools beside the legacy ones; legacy accessors stay legacy-only', async () => {
  await init({ surface: 'all' });
  assert.deepStrictEqual(manager.getToolNames(), legacyNames);
  assert.strictEqual(manager.getRegisteredToolCount(), legacyNames.length);
  assert.deepStrictEqual(manager.getCompactToolNames(), [spec.name]);
  assert.ok(manager.getPublishedToolNames().includes(spec.name));
  assert.strictEqual(manager.getToolPolicy().surface, 'all');
});

await check('initialize again drops the previous compact tools instead of accumulating them', async () => {
  await init({ surface: 'all' }, [readerOnly]);
  assert.deepStrictEqual(manager.getCompactToolNames(), [readerOnly.name]);
  assert.strictEqual(manager.getTool(spec.name), undefined);
  await init({}, []);
  assert.deepStrictEqual(manager.getCompactToolNames(), []);
});

await check('NEGATIVE: an action naming an unregistered legacy tool fails startup, naming tool and action', async () => {
  const bad = { ...readerOnly, name: 'actual_fixture_bad', actions: new Map([['go', { legacy: 'actual_nope_nothing', fields: z.object({}) }]]) };
  await assert.rejects(() => init({}, [bad]), /actual_fixture_bad.*go.*actual_nope_nothing/);
  await init({}, []);
});

await check('a compact tool is listed like any tool (tools/list entry builds, flat schema with the action enum)', async () => {
  await init({ surface: 'all' });
  const entries = buildToolListEntries([spec.name], (n) => {
    const t = manager.getTool(n);
    return { description: t.description, schema: z.toJSONSchema(t.inputSchema) };
  });
  assert.strictEqual(entries.length, 1);
  const props = entries[0].inputSchema.properties;
  assert.deepStrictEqual([...props.action.enum].sort(), ['list', 'update']);
  assert.ok(props.id && props.name && props.offbudget);
  assert.deepStrictEqual(entries[0].inputSchema.required, ['action']);
});

// ---- dispatcher ----

await check('dispatch: a reader action calls its legacy tool and returns the value unchanged (no { result } wrapper added)', async () => {
  await init({ surface: 'all' });
  calls.length = 0;
  const out = await manager.callTool(spec.name, { action: 'list' });
  assert.deepStrictEqual(calls, [{ n: LIST, args: {} }]);
  assert.deepStrictEqual(out, { result: { echoed: LIST } });
});

await check('dispatch: rename and wrap shape the legacy arguments', async () => {
  await init({ surface: 'all' });
  calls.length = 0;
  await manager.callTool(spec.name, { action: 'update', id: 'a1', name: 'N', offbudget: true });
  assert.deepStrictEqual(calls, [{ n: UPDATE, args: { id: 'a1', fields: { name: 'N', off_budget: true } } }]);
});

await check('dispatch: wrap always sends the wrapper object, even with nothing inside it', async () => {
  await init({ surface: 'all' });
  calls.length = 0;
  await manager.callTool(spec.name, { action: 'update', id: 'a1' });
  assert.deepStrictEqual(calls[0].args, { id: 'a1', fields: {} });
});

await check('dispatch: defaultAction runs when the selector is absent', async () => {
  await init({ surface: 'all' }, [withDefault]);
  calls.length = 0;
  await manager.callTool(withDefault.name, {});
  assert.strictEqual(calls[0].n, LIST);
});

await check('NEGATIVE: no selector and no defaultAction is a validation error naming the selector', async () => {
  await init({ surface: 'all' });
  calls.length = 0;
  await assert.rejects(() => manager.callTool(spec.name, {}), /action/);
  assert.strictEqual(calls.length, 0);
});

for (const bad of ['bogus', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  await check(`NEGATIVE: action ${JSON.stringify(bad)} is unknown and calls nothing`, async () => {
    await init({ surface: 'all' });
    calls.length = 0;
    await assert.rejects(() => manager.callTool(spec.name, { action: bad }), /action/);
    // dispatchCompact on its own, past the flat schema, must refuse it too.
    await assert.rejects(() => dispatchCompact({ callOperation: async () => { calls.push('x'); } }, spec, { action: bad }), (e) => e instanceof z.ZodError);
    assert.strictEqual(calls.length, 0);
  });
}

await check('NEGATIVE: a key the chosen action does not declare is refused, not dropped', async () => {
  await init({ surface: 'all' });
  calls.length = 0;
  await assert.rejects(() => manager.callTool(spec.name, { action: 'list', id: 'a1' }));
  await assert.rejects(() => manager.callTool(spec.name, { action: 'list', bogus: 1 }));
  assert.strictEqual(calls.length, 0);
});

await check('NEGATIVE: dispatchCompact on its own refuses a stray key (the per-action schema is strict, not just the flat one)', async () => {
  const seen = [];
  const ops = { callOperation: async (...a) => { seen.push(a); } };
  await assert.rejects(() => dispatchCompact(ops, spec, { action: 'list', bogus: 1 }), (e) => e instanceof z.ZodError);
  assert.strictEqual(seen.length, 0);
});

await check('NEGATIVE: a wrong type for the chosen action is refused before the legacy tool runs', async () => {
  await init({ surface: 'all' });
  calls.length = 0;
  await assert.rejects(() => manager.callTool(spec.name, { action: 'update', id: 5 }));
  await assert.rejects(() => manager.callTool(spec.name, { action: 'update' }), /id/);
  assert.strictEqual(calls.length, 0);
});

await check('dispatcher is independent of the manager: it only needs callOperation', async () => {
  const seen = [];
  const out = await dispatchCompact({ callOperation: async (n, a, via) => { seen.push([n, a, via]); return 7; } }, spec, { action: 'list' });
  assert.strictEqual(out, 7);
  assert.deepStrictEqual(seen, [[LIST, {}, { tool: spec.name, action: 'list' }]]);
  assert.strictEqual(buildCompactTool(spec, { callOperation: async () => 1 }).name, spec.name);
});

// ---- callOperation ----

await check('compact surface: a legacy tool is hidden from a direct call (MCP_TOOL_SURFACE) but reachable through the compact tool', async () => {
  await init({ surface: 'compact' });
  const e = await reason(() => manager.callTool(LIST, {}));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_TOOL_SURFACE', String(e));
  assert.match(e.message, /compact tool surface \(MCP_TOOL_SURFACE\)/);
  calls.length = 0;
  await manager.callTool(spec.name, { action: 'list' });
  assert.strictEqual(calls.length, 1);
});

await check('compact surface + read-only: callOperation on a writer refuses with MCP_READ_ONLY and the writer never runs', async () => {
  await init({ surface: 'compact', readOnly: true }, [spec, readerOnly]);
  calls.length = 0;
  const e = await reason(() => manager.callOperation(UPDATE, { id: 'a' }));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', String(e));
  assert.strictEqual(calls.length, 0);
  // The mixed compact tool is not even published; calling it is refused the same way.
  const e2 = await reason(() => manager.callTool(spec.name, { action: 'update', id: 'a' }));
  assert.ok(e2 instanceof ToolUnavailableError && e2.setting === 'MCP_READ_ONLY', String(e2));
  // A reader-only compact tool still works.
  await manager.callTool(readerOnly.name, { action: 'list' });
  assert.strictEqual(calls.length, 1);
});

await check('all surface + MCP_TOOLSETS: callOperation on a toolset-hidden legacy tool refuses naming MCP_TOOLSETS', async () => {
  await init({ surface: 'all', toolsets: 'query' });
  calls.length = 0;
  const e = await reason(() => manager.callOperation(LIST, {}));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_TOOLSETS', String(e));
  assert.strictEqual(calls.length, 0);
});

await check('legacy surface: callOperation on a compact-hidden legacy tool is NOT bypassed (the bypass needs the compact surface)', async () => {
  await init({ surface: 'legacy', toolsets: 'query' });
  const e = await reason(() => manager.callOperation(LIST, {}));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_TOOLSETS', String(e));
});

await check('NEGATIVE: callOperation never accepts a compact name or an unknown name', async () => {
  await init({ surface: 'all' });
  await assert.rejects(() => manager.callOperation(spec.name, { action: 'list' }), /Tool not found/);
  await assert.rejects(() => manager.callOperation('actual_nope_nothing', {}), /Tool not found/);
});

await check('NEGATIVE: callOperation before initialize fails closed', async () => {
  const Ctor = manager.constructor;
  await assert.rejects(() => new Ctor().callOperation(LIST, {}), /initialize\(\)/);
});

// ---- registry and source guards ----

await check('the shipped registry is empty (#671 ships no compact tool)', () => {
  assert.strictEqual(COMPACT_TOOLS.length, 0);
});

await check('src/compact/ never imports the adapter or @actual-app/api, and never calls .call(', () => {
  const dir = join(process.cwd(), 'src/compact');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/from\s+['"][^'"]*(actual-adapter|@actual-app\/api|actualToolsManager)/.test(src), `${f} imports a forbidden module`);
    assert.ok(!/import\(['"][^'"]*(actual-adapter|@actual-app\/api)/.test(src), `${f} dynamic-imports a forbidden module`);
    assert.ok(!/\.(call|apply|bind)\(/.test(src), `${f} calls a tool directly`);
  }
});

// ---- second-source guards (vacuous while the registry is empty, wired for #672 onward) ----
//
// The per-legacy-tool guards (tool_annotations, tool_description_checklist,
// new_tool_completeness) iterate the legacy registry only, so a compact tool would escape
// them. This is the same floor for the compact registry.

const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { titleFor } = await import('../../dist/src/lib/tool-titles.js');

/** Pure: problems for a list of compact specs. */
function compactMetadataProblems(specs) {
  const problems = [];
  for (const spec of specs) {
    const writes = [...spec.actions.values()].some((r) => WRITE_CAPABLE.has(r.legacy));
    const ann = annotationsFor(spec.name);
    if (titleFor(spec.name) === undefined) problems.push(`${spec.name} has no title in src/lib/tool-titles.ts`);
    if (ann.readOnlyHint === true && writes) problems.push(`${spec.name} claims readOnlyHint but an action maps to a write-capable tool`);
    if (ann.readOnlyHint !== true && !writes) problems.push(`${spec.name} has only read actions but is not annotated readOnlyHint`);
    if (!/(^|[.!?]\s+)Returns\b/.test(spec.description)) problems.push(`${spec.name} description has no "Returns" sentence`);
  }
  return problems;
}

await check('every registered compact tool has a title, truthful annotations and a Returns sentence', () => {
  assert.deepStrictEqual(compactMetadataProblems(COMPACT_TOOLS), []);
});

await check('NEGATIVE: the metadata guard names a compact tool with no title, no Returns sentence and a false readOnlyHint', () => {
  const problems = compactMetadataProblems([spec]);
  assert.ok(problems.some((p) => /no title/.test(p) && p.includes(spec.name)), problems.join('; '));
  assert.ok(problems.some((p) => /no "Returns" sentence/.test(p)), problems.join('; '));
});

restore();
await manager.initialize(ALL);
console.log(`\n[compact-dispatch] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
