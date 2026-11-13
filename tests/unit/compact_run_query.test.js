// tests/unit/compact_run_query.test.js
//
// #674: the compact run_query tool. Part 1 uses a stubbed callOperation (exact legacy call,
// refusals call nothing). Part 2 runs the REAL actual_query_run behind the REAL tools manager
// with adapter.runQuery stubbed and asserted never called: each refused query is refused by
// the legacy validation, names run_query (never actual_query_run), and no query text reaches
// the log records.
//
// Run: node tests/unit/compact_run_query.test.js   (needs `npm run build` first)

// Set BEFORE importing anything that loads the logger singleton (the logs are captured below).
process.env.MCP_STDIO_MODE = 'true';
process.env.LOG_FORMAT = 'json';
process.env.MCP_BRIDGE_LOG_LEVEL = 'debug';
process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

import assert from 'assert';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[compact-run-query]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');

const spec = COMPACT_TOOLS.find((t) => t.name === 'run_query');
assert.ok(spec, 'run_query is registered');

// ---- part 1: stubbed callOperation ----

const seen = [];
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return { from: n }; } };
const phrases = legacyPhrases(COMPACT_TOOLS);
const tool = buildCompactTool(spec, ops, phrases);
const refused = async (input, re) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  const text = [e.message, ...(e.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`)].join(' | ');
  if (re) assert.ok(re.test(text), `${re} vs ${text}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};

await check('the query reaches actual_query_run untouched, once, and the result is unchanged', async () => {
  seen.length = 0;
  const q = '  SELECT id FROM accounts  ';
  const r = await tool.call({ query: q });
  assert.deepStrictEqual(seen, [{ n: 'actual_query_run', a: { query: q } }]);
  assert.deepStrictEqual(r, { from: 'actual_query_run' });
});
await check('NEGATIVE: a missing query is refused naming query', () => refused({}, /query/));
await check('NEGATIVE: an empty query is refused naming query', () => refused({ query: '' }, /query/));
await check('NEGATIVE: a non-string query is refused naming query', () => refused({ query: 5 }, /query/));
await check('NEGATIVE: an unknown property is refused naming it', () => refused({ query: 'SELECT id FROM accounts', action: 'y' }, /action/));
await check('NEGATIVE: the flat schema refuses the same inputs', () => {
  assert.strictEqual(tool.inputSchema.safeParse({}).success, false);
  assert.strictEqual(tool.inputSchema.safeParse({ query: 'x', action: 'y' }).success, false);
  assert.strictEqual(tool.inputSchema.safeParse({ query: 'SELECT id FROM accounts' }).success, true);
});

await check('published schema: flat, strict, query required and described, no selector', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js)));
  assert.deepStrictEqual(Object.keys(js.properties), ['query']);
  assert.deepStrictEqual(js.required, ['query']);
  assert.strictEqual(js.additionalProperties, false);
  assert.ok(js.properties.query.description);
  assert.strictEqual(tool.outputSchema, undefined);
});
await check('description keeps the legacy grammar and names the siblings, no legacy name', () => {
  for (const w of ['Read-only', 'Returns', 'SELECT', 'WHERE', 'OR, REGEXP, NOT IN', 'is_parent = false', 'dot notation', 'cents', "date >= '2025-01-01'", 'hint', 'category_groups',
    'search_transactions', 'summarize_transactions', 'list_entities', 'list_budget_months']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: read-only, closed world, target not write-capable', () => {
  const a = annotationsFor('run_query');
  assert.strictEqual(a.readOnlyHint, true);
  assert.strictEqual(a.destructiveHint, false);
  assert.strictEqual(a.openWorldHint, false);
  assert.deepStrictEqual(compactLegacyNames(spec), ['actual_query_run']);
  assert.ok(!WRITE_CAPABLE.has('actual_query_run'));
});

// ---- part 2: the real legacy path ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Captures stdout and stderr (the JSON log lines) while a call runs, plus a tail for async writes.
const capture = async (fn) => {
  const chunks = [];
  const origErr = process.stderr.write.bind(process.stderr);
  const origOut = process.stdout.write.bind(process.stdout);
  process.stderr.write = (...a) => { chunks.push(String(a[0])); return true; };
  process.stdout.write = (...a) => { chunks.push(String(a[0])); return true; };
  let outcome;
  try {
    try { outcome = { value: await fn() }; } catch (error) { outcome = { error }; }
    await sleep(30);
  } finally {
    process.stderr.write = origErr;
    process.stdout.write = origOut;
  }
  return { text: chunks.join(''), ...outcome };
};
const errorRecords = (text) => text.split('\n').filter((l) => l.includes('[TOOL ERROR]')).map((l) => JSON.parse(l).context);

const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'compact' });
let runQueryCalls = 0;
adapter.runQuery = async () => { runQueryCalls++; return [{ id: 'row' }]; };

await check('real path: a clean query reaches adapter.runQuery once and comes back as the legacy { result }', async () => {
  runQueryCalls = 0;
  const r = await manager.callTool('run_query', { query: 'SELECT id FROM accounts' });
  assert.strictEqual(runQueryCalls, 1);
  assert.deepStrictEqual(r, { result: [{ id: 'row' }] });
});

const VALIDATOR = [
  ['SELECT * FROM transactions; DROP TABLE accounts', /does not allow stacked statements/],
  ['DELETE FROM transactions', /read-only/i],
  ['SELECT id FROM transactions UNION SELECT id FROM accounts', /compound|union/i],
  ['SELECT id FROM transactions -- x', /comment/i],
];
for (const [query, re] of VALIDATOR) {
  await check(`real path: refused, names run_query, nothing runs, no query text logged: ${query.slice(0, 40)}`, async () => {
    runQueryCalls = 0;
    const r = await capture(() => manager.callTool('run_query', { query }));
    assert.ok(r.error, 'must be refused');
    assert.ok(re.test(r.error.message), r.error.message);
    assert.ok(r.error.message.includes('run_query'), r.error.message);
    assert.ok(!r.error.message.includes('actual_query_run'), r.error.message);
    assert.strictEqual(runQueryCalls, 0, 'adapter.runQuery must never be called');
    assert.ok(!r.text.includes(query), 'the query text must not reach the logs');
    const recs = errorRecords(r.text);
    assert.deepStrictEqual(recs.map((x) => x.tool), ['actual_query_run', 'run_query'], 'two [TOOL ERROR] records');
    for (const rec of recs) assert.ok(!JSON.stringify(rec).includes(query.slice(0, 20)), JSON.stringify(rec));
  });
}

await check('real path: a GraphQL-style query is refused, nothing runs, logMessage is the content-free text', async () => {
  runQueryCalls = 0;
  const query = 'query { transactions { id } }';
  const r = await capture(() => manager.callTool('run_query', { query }));
  assert.ok(r.error, 'must be refused');
  assert.ok(r.error.message.includes('GraphQL syntax is not fully supported'), r.error.message);
  assert.ok(!r.error.message.includes('actual_query_run'), r.error.message);
  assert.strictEqual(runQueryCalls, 0);
  assert.ok(!r.text.includes('transactions { id }'), 'the query text must not reach the logs');
  const recs = errorRecords(r.text);
  assert.strictEqual(recs.length, 2);
  for (const rec of recs) assert.strictEqual(rec.logMessage, 'GraphQL-style query rejected', JSON.stringify(rec));
});

await check('real path: the ZodError for a missing query is a validation error naming query, nothing runs', async () => {
  runQueryCalls = 0;
  const r = await capture(() => manager.callTool('run_query', {}));
  assert.ok(r.error && /query/.test(r.error.message), r.error && r.error.message);
  assert.strictEqual(runQueryCalls, 0);
});

await check('real path: an upstream failure naming the legacy tool is rewritten in place', async () => {
  adapter.runQuery = async () => { throw new Error('boom from actual_query_run'); };
  const r = await capture(() => manager.callTool('run_query', { query: 'SELECT id FROM accounts' }));
  assert.ok(r.error && r.error.message.includes('boom from run_query') && !r.error.message.includes('actual_query_run'), r.error && r.error.message);
});

console.log(`\n[compact-run-query] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
