// tests/unit/compact_dispatch.test.js
//
// #671: MCP_TOOL_SURFACE, the compact registry, the dispatcher and callOperation.
//
// Most cases build their own compact spec over real legacy tool names and stub the legacy
// tools' `call`, so nothing here reaches the adapter. #672 adds the shipped registry checks,
// routes (a row that sends different arguments to a different legacy tool) and the 4b rewrite
// of legacy tool names in error text.
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
const { dispatchCompact, buildCompactTool, compactLegacyNames, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');
const { NotFoundRefusal, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
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
  resolvePublishedToolNames(legacyNames, { ...ALL, ...settings }, compact.map((c) => ({ name: c.name, legacy: compactLegacyNames(c) })));

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

let buildRuns = 0;
const withBuild = {
  name: 'actual_fixture_build',
  description: 'Fixture compact tool with a build hook.',
  actions: new Map([
    [
      'update',
      {
        legacy: UPDATE,
        fields: z.object({ month: z.string(), note: z.string() }),
        build: (a) => { buildRuns += 1; return { id: `budget-${String(a.month)}`, note: a.note }; },
      },
    ],
  ]),
};

await check('dispatch: build derives the legacy arguments from the validated ones', async () => {
  await init({ surface: 'all' }, [withBuild]);
  calls.length = 0;
  await manager.callTool(withBuild.name, { action: 'update', month: '2026-11', note: 'n' });
  assert.deepStrictEqual(calls, [{ n: UPDATE, args: { id: 'budget-2026-11', note: 'n' } }]);
});

await check('NEGATIVE: build never runs on arguments that fail validation, nothing is called', async () => {
  await init({ surface: 'all' }, [withBuild]);
  calls.length = 0;
  buildRuns = 0;
  await assert.rejects(() => manager.callTool(withBuild.name, { action: 'update', month: '2026-11' }), /note/);
  assert.strictEqual(calls.length, 0);
  // Counted directly: a build that ran before validation would still make no legacy call.
  assert.strictEqual(buildRuns, 0);
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

// ---- #674: a tool with `selector: null` has one action and publishes no selector ----

const noSelector = {
  name: 'fixture_no_selector',
  description: 'Fixture compact tool without a selector.',
  selector: null,
  defaultAction: 'only',
  actions: new Map([['only', {
    legacy: LIST,
    fields: z.object({}),
    routes: [{ triggers: ['id'], legacy: UPDATE, fields: z.object({ id: z.string().min(1) }) }],
  }]]),
};
const singleRequired = {
  name: 'fixture_single_required',
  description: 'Fixture compact tool with one required field.',
  selector: null,
  defaultAction: 'only',
  actions: new Map([['only', { legacy: LIST, fields: z.object({ q: z.string().min(1) }) }]]),
};

await check('selector null: no selector property is published and the route is chosen by its trigger', async () => {
  const t = buildCompactTool(noSelector, { callOperation: async (n, a) => ({ n, a }) });
  const js = z.toJSONSchema(t.inputSchema);
  assert.deepStrictEqual(Object.keys(js.properties), ['id']);
  assert.ok(!js.required || js.required.length === 0);
  assert.deepStrictEqual(await t.call({}), { n: LIST, a: {} });
  assert.deepStrictEqual(await t.call({ id: 'x' }), { n: UPDATE, a: { id: 'x' } });
});
await check('NEGATIVE: selector null refuses a caller key named like the default selector, naming it, and calls nothing', async () => {
  const t = buildCompactTool(noSelector, { callOperation: async () => { calls.push('x'); } });
  calls.length = 0;
  await assert.rejects(() => t.call({ action: 'only' }), /action/);
  // Past the flat schema, the dispatcher's own wording must not name a selector the tool lacks.
  await assert.rejects(() => dispatchCompact({ callOperation: async () => { calls.push('x'); } }, noSelector, { action: 'only' }), (e) => /not accepted by fixture_no_selector/.test(JSON.stringify(e.issues)) && !/not valid for/.test(JSON.stringify(e.issues)));
  const parsed = t.inputSchema.safeParse({ action: 'only' });
  assert.strictEqual(parsed.success, false);
  assert.ok(!/not valid for/.test(JSON.stringify(parsed.error.issues)), 'no selector wording for a tool without a selector');
  assert.strictEqual(calls.length, 0);
});
await check('selector null: the error phrase names the tool, and the route trigger, without a selector', () => {
  const phrases = legacyPhrases([noSelector]);
  assert.strictEqual(phrases.get(LIST), 'fixture_no_selector');
  assert.strictEqual(phrases.get(UPDATE), 'fixture_no_selector with id');
});
await check('selector null with one action and no routes keeps a required field required in the published schema', () => {
  const t = buildCompactTool(singleRequired, { callOperation: async () => undefined });
  assert.deepStrictEqual(z.toJSONSchema(t.inputSchema).required, ['q']);
  assert.strictEqual(t.inputSchema.safeParse({}).success, false);
  const routed = buildCompactTool(noSelector, { callOperation: async () => undefined });
  assert.ok(!z.toJSONSchema(routed.inputSchema).required);
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

await check('legacy surface: callOperation refuses a tool MCP_TOOLSETS hides', async () => {
  await init({ surface: 'legacy', toolsets: 'query' });
  const e = await reason(() => manager.callOperation(LIST, {}));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_TOOLSETS', String(e));
});

// #680: compact runs with a narrowed MCP_TOOLSETS. A compact tool is LISTED when any action's
// legacy tool is selected; each action stays refused per legacy operation, naming MCP_TOOLSETS.
const mixed = {
  name: 'actual_fixture_mixed',
  description: 'Fixture compact tool with one action inside the query toolset and one outside it.',
  actions: new Map([
    ['list', { legacy: LIST, fields: z.object({}) }],
    ['query', { legacy: 'actual_query_run', fields: z.object({}) }],
  ]),
};

await check('compact surface + MCP_TOOLSETS=query: a compact tool with one selected action is listed (#680 R1)', () => {
  const p = resolveWith({ surface: 'compact', toolsets: 'query' }, [mixed]);
  assert.deepStrictEqual([...p.published], [mixed.name]);
});

await check('NEGATIVE: compact surface + MCP_TOOLSETS=query: a compact tool with no selected action is hidden for MCP_TOOLSETS', () => {
  const p = resolveWith({ surface: 'compact', toolsets: 'query' }, [mixed, spec]);
  assert.deepStrictEqual([...p.published], [mixed.name]);
  assert.strictEqual(p.hidden.get(spec.name), 'MCP_TOOLSETS');
});

await check('NEGATIVE: compact surface: callOperation still refuses a tool MCP_TOOLSETS hides', async () => {
  await init({ surface: 'compact', toolsets: 'query' }, [mixed]);
  calls.length = 0;
  const e = await reason(() => manager.callOperation(LIST, {}));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_TOOLSETS', String(e));
  assert.strictEqual(calls.length, 0);
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

// ---- routes, drop, fixed and the 4b rewrite (#672) ----

const RA = 'actual_accounts_list';
const RB = 'actual_entities_search';
const RC = 'actual_get_id_by_name';
const qSchema = z.string().describe('query');
const nSchema = z.string().describe('name');
const lSchema = z.number().describe('limit');
const rows = { none: z.object({}) };
const routed = {
  name: 'fixture_routed',
  description: 'Fixture. Returns things.',
  selector: 'type',
  actions: new Map([
    [
      'account',
      {
        legacy: RA,
        fields: rows.none,
        routes: [
          { legacy: RB, triggers: ['query', 'limit'], fields: z.object({ query: qSchema.optional(), limit: lSchema.optional() }), fixed: { type: 'accounts' } },
          { legacy: RC, triggers: ['name'], fields: z.object({ name: nSchema.optional() }), drop: ['limit'], fixed: { type: 'accounts' } },
        ],
      },
    ],
  ]),
};
const PH_RB = 'fixture_routed with type account and query';
const PH_RC = 'fixture_routed with type account and name';
const rec = () => {
  const seen = [];
  return { seen, ops: { callOperation: async (n, a) => { seen.push({ n, a }); return { ok: n }; } } };
};
const cm = (spec2, input, ops) => dispatchCompact(ops, spec2, input);

await check('route: a trigger key sends the call to the route target with fixed args merged', async () => {
  const { seen, ops } = rec();
  await cm(routed, { type: 'account', query: 'x' }, ops);
  assert.deepStrictEqual(seen, [{ n: RB, a: { query: 'x', type: 'accounts' } }]);
});

await check('route: no trigger key uses the row default and forwards the remaining keys', async () => {
  const { seen, ops } = rec();
  await cm(routed, { type: 'account' }, ops);
  assert.deepStrictEqual(seen, [{ n: RA, a: {} }]);
});

await check('route: drop removes a compact key the target does not take', async () => {
  const dropping = { ...routed, actions: new Map([['account', { ...routed.actions.get('account'), routes: [{ legacy: RC, triggers: ['name'], fields: z.object({ name: nSchema.optional(), limit: lSchema.optional() }), drop: ['limit'] }] }]]) };
  const { seen, ops } = rec();
  await cm(dropping, { type: 'account', name: 'n', limit: 4 }, ops);
  assert.deepStrictEqual(seen, [{ n: RC, a: { name: 'n' } }]);
});

await check('NEGATIVE: fixed wins over a caller key of the same name, so the target cannot be re-pointed', async () => {
  const pinned = { ...routed, actions: new Map([['account', { ...routed.actions.get('account'), routes: [{ legacy: RB, triggers: ['query'], fields: z.object({ query: qSchema.optional(), mode: z.string().optional() }), fixed: { mode: 'pinned' } }] }]]) };
  const { seen, ops } = rec();
  await cm(pinned, { type: 'account', query: 'x', mode: 'caller' }, ops);
  assert.deepStrictEqual(seen, [{ n: RB, a: { query: 'x', mode: 'pinned' } }]);
});

await check('NEGATIVE: two routes triggered together are refused as mutually exclusive, nothing is called', async () => {
  const { seen, ops } = rec();
  const e = await reason(() => cm(routed, { type: 'account', query: 'x', name: 'n' }, ops));
  assert.ok(e instanceof z.ZodError && /mutually exclusive/.test(e.issues.map((i) => i.message).join()), String(e));
  assert.strictEqual(seen.length, 0);
});

await check('NEGATIVE: a trigger without the key its route requires is refused naming both', async () => {
  const req = { ...routed, actions: new Map([['account', { ...routed.actions.get('account'), routes: [{ legacy: RB, triggers: ['query', 'limit'], fields: z.object({ query: qSchema, limit: lSchema.optional() }) }] }]]) };
  const { seen, ops } = rec();
  const e = await reason(() => cm(req, { type: 'account', limit: 5 }, ops));
  assert.ok(e instanceof z.ZodError && e.issues.some((i) => /query: required with limit/.test(`${i.path.join('.')}: ${i.message}`)), String(e && e.message));
  assert.strictEqual(seen.length, 0);
});

await check('NEGATIVE: a key no target of the chosen row declares is refused, nothing is called', async () => {
  const { seen, ops } = rec();
  const e = await reason(() => cm(routed, { type: 'account', bogus: 1 }, ops));
  assert.ok(e instanceof z.ZodError, String(e));
  assert.strictEqual(seen.length, 0);
});

await check('compactLegacyNames lists row defaults and route targets, deduplicated', () => {
  assert.deepStrictEqual([...compactLegacyNames(routed)].sort(), [RA, RB, RC].sort());
});

await check('the flat published schema has no oneOf/anyOf and refuses what planCall refuses', () => {
  const tool = buildCompactTool(routed, rec().ops);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(z.toJSONSchema(tool.inputSchema))));
  assert.ok(!tool.inputSchema.safeParse({ type: 'account', query: 'x', name: 'n' }).success);
  assert.ok(tool.inputSchema.safeParse({ type: 'account', query: 'x' }).success);
});

await check('legacyPhrases maps a default to "tool with type X" and a route to the selector plus its trigger', () => {
  const ph = legacyPhrases([routed]);
  assert.strictEqual(ph.get(RA), 'fixture_routed with type account');
  assert.strictEqual(ph.get(RB), PH_RB);
  assert.strictEqual(ph.get(RC), PH_RC);
});

await check('legacyPhrases: a route carried by several selector values names no value; a route phrase overrides the trigger', () => {
  const account = routed.actions.get('account');
  const multi = { ...routed, actions: new Map([
    ['account', account],
    ['payee', { ...account, legacy: 'actual_payees_get', routes: [account.routes[0], { ...account.routes[1], legacy: 'actual_budgets_get_all', phrase: 'scope server' }] }],
  ]) };
  const ph = legacyPhrases([multi]);
  assert.strictEqual(ph.get(RB), 'fixture_routed with type and query');
  assert.strictEqual(ph.get(RC), PH_RC);
  assert.strictEqual(ph.get('actual_budgets_get_all'), 'fixture_routed with type payee and scope server');
});

await check('4b: a thrown error naming a legacy tool is rewritten in place and keeps its class', async () => {
  const ph = legacyPhrases([routed]);
  const err = new NotFoundRefusal('Account', 'abc', RB);
  const ops = { callOperation: async () => { throw err; } };
  const e = await reason(() => dispatchCompact(ops, routed, { type: 'account', query: 'x' }, ph));
  assert.strictEqual(e, err, 'same object');
  assert.ok(e instanceof NotFoundRefusal && isPreflightRefusal(e));
  assert.ok(!/actual_/.test(e.message) && e.message.includes(PH_RB), e.message);
});

await check('4b: a returned top-level error string is rewritten, other fields are untouched', async () => {
  const ph = legacyPhrases([routed]);
  const ops = { callOperation: async () => ({ error: `use ${RA}`, note: `keep ${RA}`, n: 1 }) };
  const r = await dispatchCompact(ops, routed, { type: 'account' }, ph);
  assert.ok(!/actual_/.test(r.error) && /fixture_routed with type account/.test(r.error), r.error);
  assert.strictEqual(r.note, `keep ${RA}`);
});

await check('4b: error and hint under the createTool { result } wrapper are rewritten, data is not', async () => {
  const ph = legacyPhrases([routed]);
  const ops = { callOperation: async () => ({ hint: `try ${RA}`, result: { error: `use ${RA}`, hint: `or ${RA}`, name: RA, rows: [{ error: RA }] } }) };
  const r = await dispatchCompact(ops, routed, { type: 'account' }, ph);
  for (const text of [r.hint, r.result.error, r.result.hint]) {
    assert.ok(!/actual_/.test(text) && /fixture_routed with type account/.test(text), text);
  }
  assert.strictEqual(r.result.name, RA, 'a data key holding a tool name is left alone');
  assert.strictEqual(r.result.rows[0].error, RA, 'nothing deeper than the wrapper is walked');
});

await check('4b (#680 R3): a success `message` naming legacy tools is rewritten, top level and under { result }', async () => {
  const ph = legacyPhrases([routed]);
  const ops = { callOperation: async () => ({ message: `Imported 3. Verify with ${RA}.`, result: { message: `then ${RA}`, rows: [{ message: RA }] } }) };
  const r = await dispatchCompact(ops, routed, { type: 'account' }, ph);
  for (const text of [r.message, r.result.message]) {
    assert.ok(!/actual_/.test(text) && /fixture_routed with type account/.test(text), text);
  }
  assert.strictEqual(r.result.rows[0].message, RA, 'nothing deeper than the wrapper is walked');
});

await check('NEGATIVE (#680 R3): a `message` naming no legacy tool comes back byte-identical, and a non-string message is untouched', async () => {
  const ph = legacyPhrases([routed]);
  const plain = 'Imported 3 transactions, 1 duplicate skipped.';
  const ops = { callOperation: async () => ({ message: plain, result: { message: 42 } }) };
  const r = await dispatchCompact(ops, routed, { type: 'account' }, ph);
  assert.strictEqual(r.message, plain);
  assert.strictEqual(r.result.message, 42);
});

await check('NEGATIVE: an unknown legacy name in error text is left as written', async () => {
  const ph = legacyPhrases([routed]);
  const ops = { callOperation: async () => { throw new Error('see actual_unknown_tool'); } };
  const e = await reason(() => dispatchCompact(ops, routed, { type: 'account' }, ph));
  assert.ok(/actual_unknown_tool/.test(e.message));
});

await check('startup validation rejects a route whose legacy tool is not registered', async () => {
  const bad = { ...routed, name: 'fixture_bad', actions: new Map([['account', { ...routed.actions.get('account'), routes: [{ legacy: 'actual_not_a_tool', triggers: ['query'], fields: z.object({ query: qSchema.optional() }) }] }]]) };
  await assert.rejects(() => manager.initialize({ ...ALL, surface: 'all' }, [bad]), /actual_not_a_tool/);
  await manager.initialize(ALL);
});

// ---- #676: flat schema typing compares declarations after one optional layer ----

const typingSpec = (a, b) => ({
  name: 'fixture_typing',
  description: 'Fixture for the flat typing rule.',
  actions: new Map([
    ['one', { legacy: LIST, fields: z.object({ name: a }) }],
    ['two', { legacy: LIST, fields: z.object({ name: b }) }],
  ]),
});
await check('flat typing: name required in one action and name.optional() in another stays a typed, described string (#676)', () => {
  const shared = z.string().describe('The name.');
  const js = z.toJSONSchema(buildCompactTool(typingSpec(shared, shared.optional()), { callOperation: async () => undefined }).inputSchema);
  assert.strictEqual(js.properties.name.type, 'string');
  assert.strictEqual(js.properties.name.description, 'The name.');
  assert.ok(!js.required.includes('name'), 'name stays optional in the flat shape');
});
await check('NEGATIVE: flat typing: two different name objects still publish an untyped key (#676)', () => {
  const js = z.toJSONSchema(buildCompactTool(typingSpec(z.string().describe('A.'), z.string().describe('B.').optional()), { callOperation: async () => undefined }).inputSchema);
  assert.strictEqual(js.properties.name.type, undefined);
  assert.strictEqual(js.properties.name.description, undefined);
});

// ---- registry and source guards ----

await check('the shipped registry holds exactly the eleven compact tools so far (#672 to #676)', () => {
  assert.deepStrictEqual(COMPACT_TOOLS.map((t) => t.name), ['get_context', 'list_entities', 'search_transactions', 'summarize_transactions', 'list_budget_months', 'run_query', 'manage_transactions', 'manage_accounts', 'manage_categories', 'manage_payees', 'manage_tags', 'manage_rules', 'manage_schedules', 'manage_budget_months', 'manage_budget_files']);
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

// ---- second-source guards (run over the shipped registry) ----
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
    const writes = compactLegacyNames(spec).some((n) => WRITE_CAPABLE.has(n));
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
