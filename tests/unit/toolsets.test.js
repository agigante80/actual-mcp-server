// tests/unit/toolsets.test.js
//
// #483: MCP_TOOLSETS, MCP_TOOLS, MCP_READ_ONLY and the `chat` preset (idea and first
// implementation by @andycarlberg in PR #520).
//
// What this proves, and why each part exists:
//   - the groups PARTITION the registry exactly, and the registry equals IMPLEMENTED_TOOLS;
//   - unset config changes nothing (published list deep-equals the registered list);
//   - WRITE_CAPABLE (the hard-coded read-only set) is re-derived from the adapter call graph
//     and fails closed, naming the tool, when a writer is missing from it;
//   - a hidden tool is refused at dispatch with the typed ToolUnavailableError, and nothing
//     reaches the adapter;
//   - a preset never points the model at a tool the preset hides, unless a published
//     substitute is named;
//   - MCP_READ_ONLY is parsed strictly, in one place (src/config.ts).
//
// No count literals except the WRITE_CAPABLE size the gate asked to be pinned: everything
// else is derived from IMPLEMENTED_TOOLS, PRESETS and WRITE_CAPABLE.
//
// Run: node tests/unit/toolsets.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  ROOT,
  classifyAdapterMethods,
  adapterCallsOf,
  sideEffectsOf,
  sideEffectsInSource,
  adapterCallsInSource,
  classifyAdapterSource,
} from './helpers/adapter-call-graph.js';

// The CI dummy env, set BEFORE anything imports src/config.ts (which exits on invalid env).
process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
// The suite must exercise the DEFAULT config for the "unset" cases, whatever the caller exported.
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete process.env[k];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[toolsets]');

const toolsets = await import('../../dist/src/lib/toolsets.js');
const { TOOLSETS, PRESETS, WRITE_CAPABLE, resolvePublishedToolNames } = toolsets;
const { ToolUnavailableError, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const { configSchema } = await import('../../dist/src/config.js');
const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const { z } = await import('zod');

const ALL = { toolsets: 'all', tools: '', readOnly: false };
await manager.initialize(ALL);
const registered = manager.getToolNames();

const implementedSrc = read('src/actualToolsManager.ts');
const implemented = [...implementedSrc.slice(0, implementedSrc.indexOf('];')).matchAll(/'(actual_[A-Za-z0-9_]+)'/g)].map((m) => m[1]);

const resolve = (s) => resolvePublishedToolNames(registered, { toolsets: 'all', tools: '', readOnly: false, ...s });
const publishedOf = (s) => [...resolve(s).published];
const sameSet = (a, b) => assert.deepStrictEqual([...a].sort(), [...b].sort());
const throwsMatching = (fn, re, label) => {
  assert.throws(fn, (e) => re.test(e.message), label);
};

// ---------------------------------------------------------------- registry and partition

await check('the registry served equals IMPLEMENTED_TOOLS as a set', () => {
  assert.ok(implemented.length > 0, 'derivation found no IMPLEMENTED_TOOLS entries');
  sameSet(registered, implemented);
});

await check('every registered tool belongs to exactly ONE toolset, and no toolset names a ghost', () => {
  const seen = new Map();
  for (const [group, members] of Object.entries(TOOLSETS)) {
    for (const m of members) seen.set(m, [...(seen.get(m) ?? []), group]);
  }
  const unassigned = registered.filter((n) => !seen.has(n));
  const multi = [...seen].filter(([, g]) => g.length > 1).map(([n, g]) => `${n} in ${g.join('+')}`);
  const ghosts = [...seen.keys()].filter((n) => !registered.includes(n));
  assert.deepStrictEqual({ unassigned, multi, ghosts }, { unassigned: [], multi: [], ghosts: [] });
});

await check('every preset member is registered', () => {
  for (const [name, members] of Object.entries(PRESETS)) {
    const missing = members.filter((m) => !registered.includes(m));
    assert.deepStrictEqual(missing, [], `preset ${name} names unregistered tools`);
    assert.strictEqual(new Set(members).size, members.length, `preset ${name} lists a tool twice`);
  }
});

await check('NEGATIVE: a preset naming an unregistered tool fails the resolver, naming it', () => {
  const without = registered.filter((n) => n !== PRESETS.chat[0]);
  throwsMatching(
    () => resolvePublishedToolNames(without, ALL),
    new RegExp(PRESETS.chat[0]),
    'resolver must name the missing preset member',
  );
});

// ---------------------------------------------------------------- default config

await check('unset config publishes the registry unchanged: same names, same order, same list entries', () => {
  const policy = resolve({});
  assert.deepStrictEqual([...policy.published], registered);
  assert.strictEqual(policy.hidden.size, 0);
  const entryFor = (name) => {
    const tool = manager.getTool(name);
    return () => ({
      description: tool.description,
      schema: tool.inputSchema ? z.toJSONSchema(tool.inputSchema) : undefined,
    });
  };
  assert.deepStrictEqual(
    JSON.stringify(buildToolListEntries([...policy.published], (n) => entryFor(n)())),
    JSON.stringify(buildToolListEntries(registered, (n) => entryFor(n)())),
  );
});

await check('an empty MCP_TOOLSETS means all', () => {
  assert.deepStrictEqual(publishedOf({ toolsets: '' }), registered);
  assert.deepStrictEqual(publishedOf({ toolsets: '  ' }), registered);
});

// ---------------------------------------------------------------- selection

await check('MCP_TOOLSETS publishes exactly the union of the named toolsets, in registry order', () => {
  const got = publishedOf({ toolsets: ' context , query ' });
  sameSet(got, [...TOOLSETS.context, ...TOOLSETS.query]);
  assert.deepStrictEqual(got, registered.filter((n) => got.includes(n)), 'registry order is preserved');
});

await check('MCP_TOOLS adds individual tools on top of the toolsets', () => {
  const extra = TOOLSETS.context[1];
  sameSet(publishedOf({ toolsets: 'query', tools: extra }), [...TOOLSETS.query, extra]);
});

await check('MCP_TOOLSETS=chat publishes exactly the preset; a preset combines with a toolset', () => {
  sameSet(publishedOf({ toolsets: 'chat' }), PRESETS.chat);
  sameSet(publishedOf({ toolsets: 'chat,schedules' }), [...PRESETS.chat, ...TOOLSETS.schedules]);
});

await check('NEGATIVE: unknown toolset, preset or tool name fails, naming the value and the valid names', () => {
  throwsMatching(() => resolve({ toolsets: 'transactons' }), /transactons[\s\S]*Valid names[\s\S]*transactions/, 'typo in MCP_TOOLSETS');
  throwsMatching(() => resolve({ toolsets: 'context,chatt' }), /chatt/, 'typo in a preset');
  throwsMatching(() => resolve({ tools: 'actual_accounts_lst' }), /MCP_TOOLS[\s\S]*actual_accounts_lst/, 'typo in MCP_TOOLS');
  throwsMatching(() => resolve({ toolsets: ',,' }), /names no toolset/, 'only separators');
});

await check('NEGATIVE: MCP_TOOLS needs the full registered name (no silent prefix guessing)', () => {
  const short = TOOLSETS.context[1].replace(/^actual_/, '');
  throwsMatching(() => resolve({ tools: short }), /MCP_TOOLS/, 'unprefixed name must be rejected');
});

// ---------------------------------------------------------------- read-only

await check('MCP_READ_ONLY with all publishes no write-capable tool, and every other tool', () => {
  const got = publishedOf({ readOnly: true });
  assert.deepStrictEqual(got.filter((n) => WRITE_CAPABLE.has(n)), []);
  sameSet(got, registered.filter((n) => !WRITE_CAPABLE.has(n)));
});

await check('read-only overrides MCP_TOOLS: a writer named there stays unpublished', () => {
  const writer = [...WRITE_CAPABLE][0];
  const policy = resolve({ readOnly: true, tools: writer });
  assert.ok(!policy.published.includes(writer));
  assert.strictEqual(policy.hidden.get(writer), 'MCP_READ_ONLY');
});

await check('read-only with chat publishes PRESETS.chat minus WRITE_CAPABLE (and that is not empty)', () => {
  const want = PRESETS.chat.filter((n) => !WRITE_CAPABLE.has(n));
  assert.ok(want.length > 0);
  sameSet(publishedOf({ toolsets: 'chat', readOnly: true }), want);
});

await check('NEGATIVE: a configuration that resolves to zero tools fails startup', () => {
  throwsMatching(() => resolve({ toolsets: 'structure', readOnly: true }), /0 tools/, 'structure is all writers');
});

await check('the hide reason is the setting responsible (MCP_READ_ONLY first when both apply)', () => {
  const policy = resolve({ toolsets: 'query', readOnly: true });
  assert.strictEqual(policy.hidden.get('actual_transactions_delete'), 'MCP_READ_ONLY');
  const queryNames = publishedOf({ toolsets: 'query' });
  const nonWriter = registered.find((n) => !WRITE_CAPABLE.has(n) && !queryNames.includes(n));
  assert.ok(nonWriter, 'a non-writer outside the query toolset must exist');
  assert.strictEqual(policy.hidden.get(nonWriter), 'MCP_TOOLSETS');
  const readOnlyAll = resolve({ readOnly: true });
  assert.strictEqual(readOnlyAll.hidden.get('actual_bank_sync'), 'MCP_READ_ONLY');
});

await check('the resolved policy object, published and settings are frozen', () => {
  const policy = resolve({});
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.published) && Object.isFrozen(policy.settings));
});

// ---------------------------------------------------------------- MCP_READ_ONLY parsing (config.ts)

const BASE_ENV = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'dummy',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};
const parseEnv = (extra) => configSchema.safeParse({ ...BASE_ENV, ...extra });

await check('MCP_READ_ONLY: true in any case, with whitespace, is read-only', () => {
  for (const v of ['true', 'TRUE', ' true ', 'True']) {
    const r = parseEnv({ MCP_READ_ONLY: v });
    assert.ok(r.success && r.data.MCP_READ_ONLY === true, `${JSON.stringify(v)} must be read-only`);
  }
});

await check('MCP_READ_ONLY: false, empty and unset are not read-only', () => {
  for (const extra of [{ MCP_READ_ONLY: 'false' }, { MCP_READ_ONLY: ' FALSE ' }, { MCP_READ_ONLY: '' }, {}]) {
    const r = parseEnv(extra);
    assert.ok(r.success && r.data.MCP_READ_ONLY === false, `${JSON.stringify(extra)} must not be read-only`);
  }
});

await check('NEGATIVE: MCP_READ_ONLY=1, yes, on and a typo abort, naming the variable and echoing the value', () => {
  for (const v of ['1', 'yes', 'on', 'ture']) {
    const r = parseEnv({ MCP_READ_ONLY: v });
    assert.ok(!r.success, `${v} must be rejected`);
    const msg = r.error.issues.map((i) => i.message).join(' ');
    assert.ok(msg.includes('MCP_READ_ONLY') && msg.includes(JSON.stringify(v)) && /"true" or "false"/.test(msg), msg);
  }
});

await check('MCP_TOOLSETS and MCP_TOOLS default to all and empty', () => {
  const r = parseEnv({});
  assert.ok(r.success && r.data.MCP_TOOLSETS === 'all' && r.data.MCP_TOOLS === '');
});

// ---------------------------------------------------------------- WRITE_CAPABLE guard

// Tools whose adapter path is opaque to the call graph, each reviewed by hand. Both are
// asserted below to have NO visible `adapter.*` call, which is why the graph cannot see them.
const OPAQUE_READ = {
  actual_server_info: 'reads package metadata, process stats and the tool registry; never touches the adapter',
  actual_session_list: 'reads the connection pool directly (it manages the pool, not budget data)',
};

// Mutators that never reach queueWriteOperation: the call graph says "read", reality says write.
const NON_QUEUE_MUTATORS = ['actual_bank_sync', 'actual_budgets_export', 'actual_budgets_switch', 'actual_session_close'];

// Adapter methods a non-queue mutator calls that are nonetheless pure reads, each reviewed.
// Every OTHER adapter method a non-queue mutator calls counts as a write (below), so a new
// tool calling `adapter.runBankSync(` is a writer even though runBankSync never queues.
const SHARED_READS = {
  resolveFilterId: 'resolves an account name to an id; a lookup, used by bank_sync and many readers',
};

/**
 * Classify every name. Returns the problems found, so the negative fixtures below can feed it
 * a synthetic registry. Fails closed: a tool file that is missing throws.
 *
 * A tool is a derived writer when it calls an adapter method in `writes`, or has a direct
 * side effect (`sideEffectsOf`: fs writes, session teardown, pool mutation). There is no
 * name-based exemption: the four non-queue mutators must derive as writers like any other.
 */
function writeCapableProblems({ names, writeCapable, writes, callsOf, sideEffectsOf: effectsOf, opaque }) {
  const problems = [];
  for (const n of names) {
    const calls = callsOf(n); // throws on a missing file
    const effects = effectsOf(n); // throws on a missing file
    const derivedWrite = calls.some((c) => writes.has(c)) || effects.length > 0;
    const inSet = writeCapable.has(n);
    if (derivedWrite && !inSet) {
      problems.push(`${n}: it can change state (${[...calls.filter((c) => writes.has(c)), ...effects].join(', ')}) but it is NOT in WRITE_CAPABLE`);
    } else if (inSet && !derivedWrite) {
      problems.push(`${n}: in WRITE_CAPABLE but no adapter call writes and it has no direct side effect`);
    } else if (!inSet) {
      if (n in opaque) {
        if (calls.length !== 0) problems.push(`${n}: listed OPAQUE_READ but has visible adapter calls (${calls.join(', ')})`);
      } else if (calls.length === 0) {
        problems.push(`${n}: unclassifiable: no visible adapter call and not on the reviewed OPAQUE_READ list`);
      }
    }
  }
  for (const w of writeCapable) if (!names.includes(w)) problems.push(`${w}: in WRITE_CAPABLE but not registered`);
  return problems;
}

const { writes: queueWrites } = classifyAdapterMethods();
// The adapter methods the non-queue mutators reach, minus the reviewed shared reads.
const nonQueueWrites = new Set(
  NON_QUEUE_MUTATORS.flatMap((n) => adapterCallsOf(n)).filter((m) => !(m in SHARED_READS)),
);
const writes = new Set([...queueWrites, ...nonQueueWrites]);

await check('the derivation is real (guards every WRITE_CAPABLE check below passing over nothing)', () => {
  assert.ok(writes.size > 20, `expected many write adapter methods, found ${writes.size}`);
  assert.ok(writes.has('setBudgetBatch'), 'setBudgetBatch must classify as a write');
  assert.ok(writes.has('createRulesBatch'), 'createRulesBatch must classify as a write');
});

await check('WRITE_CAPABLE matches the adapter call graph for every registered tool', () => {
  const problems = writeCapableProblems({
    names: registered,
    writeCapable: WRITE_CAPABLE,
    writes,
    callsOf: adapterCallsOf,
    sideEffectsOf,
    opaque: OPAQUE_READ,
  });
  assert.deepStrictEqual(problems, []);
});

await check('WRITE_CAPABLE is pinned at 47 and includes the four queue-bypassing mutators', () => {
  assert.strictEqual(WRITE_CAPABLE.size, 47);
  for (const n of NON_QUEUE_MUTATORS) assert.ok(WRITE_CAPABLE.has(n), `${n} must be write-capable`);
});

await check('NEGATIVE: a synthetic writer tool missing from WRITE_CAPABLE is caught', () => {
  const names = [...registered, 'actual_synthetic_writer'];
  const problems = writeCapableProblems({
    names,
    writeCapable: WRITE_CAPABLE,
    writes,
    callsOf: (n) => (n === 'actual_synthetic_writer' ? ['createRulesBatch'] : adapterCallsOf(n)),
    sideEffectsOf: (n) => (n === 'actual_synthetic_writer' ? [] : sideEffectsOf(n)),
    opaque: OPAQUE_READ,
  });
  assert.deepStrictEqual(problems, ['actual_synthetic_writer: it can change state (createRulesBatch) but it is NOT in WRITE_CAPABLE']);
});

await check('the non-queue write methods are derived, not empty', () => {
  assert.deepStrictEqual([...nonQueueWrites].sort(), ['exportBudget', 'runBankSync', 'switchBudget']);
  for (const m of Object.keys(SHARED_READS)) assert.ok(!writes.has(m), `${m} is a reviewed shared read and must not count as a write`);
});

await check('NEGATIVE: a synthetic tool calling a NON-queue writer (runBankSync) is caught', () => {
  const problems = writeCapableProblems({
    names: [...registered, 'actual_synthetic_sync_all'],
    writeCapable: WRITE_CAPABLE,
    writes,
    callsOf: (n) => (n === 'actual_synthetic_sync_all' ? ['resolveFilterId', 'runBankSync'] : adapterCallsOf(n)),
    sideEffectsOf: (n) => (n === 'actual_synthetic_sync_all' ? [] : sideEffectsOf(n)),
    opaque: OPAQUE_READ,
  });
  assert.deepStrictEqual(problems, ['actual_synthetic_sync_all: it can change state (runBankSync) but it is NOT in WRITE_CAPABLE']);
});

await check('NEGATIVE: a synthetic tool with only a direct side effect (fs write, session teardown) is caught', () => {
  const src = "import { writeFile } from 'node:fs/promises';\nimport { shutdownActualForSession } from '../actualConnection.js';\nawait writeFile('x', 'y');\nawait shutdownActualForSession('s');\nconnectionPool.touch('s');\nconnectionPool.getStats();";
  assert.deepStrictEqual(sideEffectsInSource(src), ['connectionPool.touch', 'fs.writeFile', 'shutdownActualForSession']);
  assert.deepStrictEqual(sideEffectsInSource("import { readFileSync } from 'fs';\nconnectionPool.getStats();\n// writeFile( shutdownActualForSession("), []);
  const problems = writeCapableProblems({
    names: [...registered, 'actual_synthetic_exporter'],
    writeCapable: WRITE_CAPABLE,
    writes,
    callsOf: (n) => (n === 'actual_synthetic_exporter' ? ['getAccounts'] : adapterCallsOf(n)),
    sideEffectsOf: (n) => (n === 'actual_synthetic_exporter' ? ['fs.writeFile'] : sideEffectsOf(n)),
    opaque: OPAQUE_READ,
  });
  assert.deepStrictEqual(problems, ['actual_synthetic_exporter: it can change state (fs.writeFile) but it is NOT in WRITE_CAPABLE']);
});

// The three adapter-calling non-queue mutators derive as writers because `nonQueueWrites` is
// built from their own calls, so this loop cannot fail for them; the real guard for those is
// the pin of `nonQueueWrites` above. Only session_close (a direct side effect) can fail here.
await check('session_close derives as a writer from its own direct side effect (the other three are writers by construction)', () => {
  for (const n of NON_QUEUE_MUTATORS) {
    const derived = adapterCallsOf(n).some((c) => writes.has(c)) || sideEffectsOf(n).length > 0;
    assert.ok(derived, `${n} must derive as a writer from its source, not from a name list`);
  }
});

await check('NEGATIVE: a registered tool whose file is missing fails closed', () => {
  assert.throws(() => adapterCallsOf('actual_does_not_exist'), /does not exist/);
});

await check('NEGATIVE: a call-graph classifier keyed on anything but queueWriteOperation is not accepted', () => {
  // A function that merely MENTIONS a writer in a comment is a read; one that calls it is a write.
  const src = [
    'export function readsOnly() {\n  // queueWriteOperation( is mentioned here only\n  return 1;\n}',
    'export async function reallyWrites() {\n  return queueWriteOperation(async () => 1);\n}',
    'export default {',
  ].join('\n');
  const { writes: w, reads: r } = classifyAdapterSource(src);
  assert.deepStrictEqual([[...w], [...r]], [['reallyWrites'], ['readsOnly']]);
  assert.deepStrictEqual(adapterCallsInSource('adapter.foo(1);\n// adapter.bar(2)'), ['foo']);
});

await check('every OPAQUE_READ entry is registered, has no adapter call, and is not write-capable', () => {
  for (const n of Object.keys(OPAQUE_READ)) {
    assert.ok(registered.includes(n), `${n} is not registered`);
    assert.deepStrictEqual(adapterCallsOf(n), [], `${n} has a visible adapter call`);
    assert.ok(!WRITE_CAPABLE.has(n));
  }
  assert.deepStrictEqual(Object.keys(OPAQUE_READ).sort(), ['actual_server_info', 'actual_session_list']);
});

await check('every tool named in a documented MCP_TOOLS example is registered', () => {
  // A wrong name in the copy-paste example stops startup for whoever copies it (#483 review).
  // Window: the line naming MCP_TOOLS and the two after it, which covers the .env.example
  // comment block where the example sits on the following line.
  const files = ['README.md', '.env.example', 'unraid/actual-mcp-server.xml', 'docs/CONFIGURATION.md', 'docs/guides/AI_CLIENT_SETUP.md'];
  let seen = 0;
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (!/\bMCP_TOOLS\b/.test(line)) return;
      for (const m of lines.slice(i, i + 3).join('\n').matchAll(/\bactual_[a-z_A-Z]+/g)) {
        seen++;
        assert.ok(registered.includes(m[0]), `${f}:${i + 1}: MCP_TOOLS example names ${m[0]}, which is not registered`);
      }
    });
  }
  assert.ok(seen >= 3, `expected the README, .env.example and unraid examples to be scanned, saw ${seen} names`);
});

// ---------------------------------------------------------------- preset reference guard

/** Every string a model reads about a tool: its description plus every .describe() in its schema. */
function modelFacingText(name) {
  const tool = manager.getTool(name);
  const texts = [tool.description ?? ''];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (typeof node.description === 'string') texts.push(node.description);
      Object.values(node).forEach(walk);
    }
  };
  if (tool.inputSchema) walk(z.toJSONSchema(tool.inputSchema));
  return texts.join('\n');
}

/**
 * Each entry: a tool the preset hides but a member's text still mentions, and the PUBLISHED
 * tool the model can use instead. The structural rule below (the substitute must itself be in
 * the preset) replaces a numeric cap: an entry with no published substitute fails, and that is
 * the real signal that the preset is wrong.
 */
const CHAT_REFERENCE_ALLOWLIST = {
  actual_budgets_getMonths: {
    substitute: 'actual_budgets_getMonth',
    reason: 'the out-of-range refusal from setAmount and the budget batch states the first and last month',
  },
  actual_rules_get: {
    substitute: 'actual_query_run',
    reason: 'query_run reads the rules table (actual-schema.ts)',
  },
  actual_entities_search: {
    substitute: 'actual_query_run',
    reason: 'query_run reads the payees table (get_context payeeLimit text)',
  },
  actual_get_id_by_name: {
    substitute: 'actual_query_run',
    reason: 'query_run reads the payees table (get_context payeeLimit text)',
  },
};

function presetReferenceProblems(members, allowlist) {
  const memberSet = new Set(members);
  const problems = [];
  const used = new Set();
  for (const m of members) {
    const text = modelFacingText(m);
    for (const ref of new Set([...text.matchAll(/actual_[A-Za-z0-9_]+/g)].map((x) => x[0]))) {
      if (!registered.includes(ref) || memberSet.has(ref) || ref === m) continue;
      used.add(ref);
      const entry = allowlist[ref];
      if (!entry) problems.push(`${m} mentions ${ref}, which the preset hides, with no allowlist entry`);
      else if (!memberSet.has(entry.substitute)) problems.push(`${ref}: substitute ${entry.substitute} is not published by the preset`);
    }
  }
  for (const k of Object.keys(allowlist)) if (!used.has(k)) problems.push(`${k}: stale allowlist entry, no member mentions it`);
  return problems;
}

await check('chat: no member points the model at a hidden tool unless a published substitute is allowlisted', () => {
  assert.deepStrictEqual(presetReferenceProblems(PRESETS.chat, CHAT_REFERENCE_ALLOWLIST), []);
});

await check('NEGATIVE: the reference guard catches an unlisted reference and an unpublished substitute', () => {
  const missing = presetReferenceProblems(PRESETS.chat, {});
  assert.ok(missing.length >= Object.keys(CHAT_REFERENCE_ALLOWLIST).length, 'an empty allowlist must produce findings');
  const broken = { ...CHAT_REFERENCE_ALLOWLIST, actual_rules_get: { substitute: 'actual_schedules_get', reason: 'x' } };
  assert.ok(presetReferenceProblems(PRESETS.chat, broken).some((p) => /not published by the preset/.test(p)));
});

// ---------------------------------------------------------------- dispatch (manager)

await check('callTool refuses a hidden tool with ToolUnavailableError naming MCP_TOOLSETS, and nothing is written', async () => {
  const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
  const original = adapter.deleteTransaction;
  let adapterCalls = 0;
  adapter.deleteTransaction = async () => { adapterCalls++; return {}; };
  const args = { id: '00000000-0000-4000-8000-000000000001' };
  try {
    await manager.initialize({ toolsets: 'query', tools: '', readOnly: false });
    const err = await manager.callTool('actual_transactions_delete', args).then(() => null, (e) => e);
    assert.strictEqual(adapterCalls, 0, 'a refused call must not reach the adapter');
    assert.ok(err instanceof ToolUnavailableError, `expected ToolUnavailableError, got ${err}`);
    assert.strictEqual(err.setting, 'MCP_TOOLSETS');
    assert.strictEqual(err.tool, 'actual_transactions_delete');
    assert.ok(/MCP_TOOLSETS/.test(err.message));
    assert.ok(!isPreflightRefusal(err));
    // Positive control: the stub is live, so the 0 above is meaningful.
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
    const ok = await manager.callTool('actual_transactions_delete', args);
    assert.deepStrictEqual(ok, { success: true });
    assert.strictEqual(adapterCalls, 1, 'the same call under toolsets=all must reach the stubbed adapter');
  } finally {
    adapter.deleteTransaction = original;
  }
});

await check('callTool under chat + read-only refuses a writer naming MCP_READ_ONLY (read-only wins the reason)', async () => {
  await manager.initialize({ toolsets: 'chat', tools: '', readOnly: true });
  const err = await manager.callTool('actual_bank_sync', {}).then(() => null, (e) => e);
  assert.ok(err instanceof ToolUnavailableError, `expected ToolUnavailableError, got ${err}`);
  assert.strictEqual(err.setting, 'MCP_READ_ONLY');
  assert.ok(/MCP_READ_ONLY=true/.test(err.message));
});

await check('unavailableError fails closed: it decides on the published list, not on hidden', async () => {
  const { unavailableError } = toolsets;
  const handBuilt = { published: Object.freeze(['actual_accounts_list']), hidden: new Map(), registered: 2, settings: {} };
  const e1 = unavailableError(handBuilt, 'actual_bank_sync');
  assert.ok(e1 instanceof ToolUnavailableError);
  assert.strictEqual(e1.setting, 'MCP_TOOLSETS');
  assert.strictEqual(unavailableError(handBuilt, 'actual_accounts_list'), undefined);
  const chat = resolve({ toolsets: 'chat' });
  chat.hidden.delete('actual_bank_sync');
  assert.ok(unavailableError(chat, 'actual_bank_sync') instanceof ToolUnavailableError, 'a missing hidden entry must not unhide a tool');
});

await check('the resolver partitions the registry: published and hidden are disjoint and cover it', () => {
  const policy = resolve({ toolsets: 'chat', readOnly: true });
  const hiddenKeys = [...policy.hidden.keys()];
  assert.deepStrictEqual(policy.published.filter((n) => policy.hidden.has(n)), []);
  sameSet([...policy.published, ...hiddenKeys], registered);
  assert.strictEqual(policy.published.length + hiddenKeys.length, registered.length);
});

await check('callTool refuses a write-capable tool under MCP_READ_ONLY=true with setting MCP_READ_ONLY', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true });
  await assert.rejects(
    () => manager.callTool('actual_bank_sync', {}),
    (e) => e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY',
  );
});

await check('an unregistered name keeps "Tool not found" under the default config', async () => {
  await manager.initialize(ALL);
  await assert.rejects(
    () => manager.callTool('actual_no_such_tool', {}),
    (e) => !(e instanceof ToolUnavailableError) && /^Tool not found: actual_no_such_tool$/.test(e.message),
  );
});

await check('getPublishedToolNames follows the stored policy', async () => {
  await manager.initialize({ toolsets: 'chat', tools: '', readOnly: false });
  sameSet(manager.getPublishedToolNames(), PRESETS.chat);
  assert.ok(!manager.getPublishedToolNames().includes('actual_bank_sync'));
});

await check('NEGATIVE: before initialize() the manager fails closed instead of publishing everything', async () => {
  const fresh = (await import('../../dist/src/actualToolsManager.js?fresh-instance')).default;
  assert.notStrictEqual(fresh, manager, 'the fresh import must be a distinct instance');
  assert.throws(() => fresh.getPublishedToolNames(), /initialize\(\)/);
  await assert.rejects(() => fresh.callTool('actual_accounts_list', {}), /initialize\(\)/);
});

await check('NEGATIVE: initialize() with an unknown name rejects (startup fails)', async () => {
  const fresh = (await import('../../dist/src/actualToolsManager.js?fresh-bad-config')).default;
  await assert.rejects(() => fresh.initialize({ toolsets: 'transactons', tools: '', readOnly: false }), /transactons/);
  assert.throws(() => fresh.getPublishedToolNames(), /initialize\(\)/, 'a failed initialize must not leave a usable policy');
});

// ---------------------------------------------------------------- consumers of the name list

await check('fetchCapabilities lists exactly the published tools, not the registry', async () => {
  await manager.initialize({ toolsets: 'chat', tools: '', readOnly: false });
  const { ActualMCPConnection } = await import('../../dist/src/lib/ActualMCPConnection.js');
  const caps = await new ActualMCPConnection().fetchCapabilities();
  sameSet(caps.tools.list.map((t) => t.name), PRESETS.chat);
});

await check('server_info reports the published total, the registered total and the resolved policy', async () => {
  await manager.initialize({ toolsets: 'chat', tools: 'actual_server_info', readOnly: false });
  const info = await manager.callTool('actual_server_info', {});
  assert.strictEqual(info.tools.total, manager.getPublishedToolNames().length);
  assert.strictEqual(info.tools.total, new Set([...PRESETS.chat, 'actual_server_info']).size);
  assert.strictEqual(info.tools.registered, registered.length);
  assert.deepStrictEqual(info.tools.policy, { toolsets: ['chat'], tools: ['actual_server_info'], readOnly: false });
});

// ---------------------------------------------------------------- source assertions

function srcFiles(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? srcFiles(rel) : rel.endsWith('.ts') ? [rel] : [];
  });
}
const SRC = srcFiles('src');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

await check('only actualToolsManager.ts dispatches a tool (the one place that refuses hidden tools)', () => {
  const callers = SRC.filter((f) => /\btool\.call\(/.test(code(f)));
  assert.deepStrictEqual(callers, ['src/actualToolsManager.ts']);
  assert.ok(!/\binvoke\b/.test(code('src/server/httpServer.ts')), 'the dead invoke fallback must stay deleted');
});

await check('every tools/list path takes its names from getPublishedToolNames, not the registry', () => {
  assert.ok(/getPublishedToolNames\(\)/.test(code('src/index.ts')));
  assert.ok(!/\bgetToolNames\(\)/.test(code('src/index.ts')), 'index.ts must not serve the registry list');
  const registryReaders = SRC.filter((f) => /\bgetToolNames\(\)/.test(code(f)));
  assert.deepStrictEqual(registryReaders.sort(), ['src/actualToolsManager.ts', 'src/tools/server_info.ts']);
});

await check('the toolset policy reads no annotations and no environment, and has no refresh hook', () => {
  const t = code('src/lib/toolsets.ts');
  assert.ok(!/tool-annotations|annotationsFor|_ANNOTATION_SETS|readOnlyHint/.test(t), 'toolsets.ts must not branch on annotations');
  assert.ok(!/process\.env/.test(t) && !/process\.env/.test(code('src/actualToolsManager.ts')));
  assert.ok(!/refreshPublishedTools/.test(SRC.map(code).join('\n')));
  // config.ts is the one reader: it parses the whole environment through configSchema.
  const envReaders = SRC.filter((f) => f !== 'src/config.ts' && /MCP_(TOOLSETS|TOOLS|READ_ONLY)\b/.test(code(f)) && /process\.env/.test(code(f)));
  assert.deepStrictEqual(envReaders, []);
});

await check('ToolUnavailableError is not a PreflightRefusal and carries only the two hiding settings', () => {
  const e = new ToolUnavailableError('actual_x', 'MCP_READ_ONLY');
  assert.ok(!isPreflightRefusal(e));
  assert.strictEqual(e.name, 'ToolUnavailableError');
  assert.ok(!/extends PreflightRefusal/.test(code('src/lib/errors.ts').match(/class ToolUnavailableError[^{]*/)[0]));
  assert.ok(/ToolUnavailableSetting = 'MCP_TOOLSETS' \| 'MCP_READ_ONLY'/.test(read('src/lib/errors.ts')));
});

console.log(`\n[toolsets] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
