// tests/unit/tool_output_schema.test.js
//
// #642: MCP outputSchema + structuredContent for exactly two tools (actual_accounts_list and
// actual_accounts_get_balance). Covers the framing helper, the manager's verdict and its
// `output_mismatch` log outcome, the published tools/list entries (SDK-parsable, root
// `type: "object"`, loose), the OpenAI/ECMA-262 compat walk over output schemas, and the
// regression that an uncovered tool is byte-identical to today's framing.
//
// Every NEGATIVE case builds its failing input and asserts the guard reports it, so each is
// proven able to fail. Run: node tests/unit/tool_output_schema.test.js (needs `npm run build`).

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[#642] outputSchema + structuredContent');

const { z } = await import('zod');
const { ListToolsResultSchema } = await import('@modelcontextprotocol/sdk/types.js');
const { frameToolResult, outputJsonSchema, executeAndFrame } = await import('../../dist/src/lib/tool-output.js');
const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const logger = (await import('../../dist/src/logger.js')).default;
const { ActualMCPConnection } = await import('../../dist/src/lib/ActualMCPConnection.js');

await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });

const COVERED = ['actual_accounts_list', 'actual_accounts_get_balance'];
const SENTINEL = 'SENTINEL-VALUE-9f3a';

// ---- stubs and log capture -------------------------------------------------------------
async function withStubs(stubs, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(stubs)) { originals[k] = adapter[k]; adapter[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(originals)) adapter[k] = v; }
}
async function captureLogs(fn) {
  const records = [];
  const o = { info: logger.info, warn: logger.warn };
  logger.info = (msg, meta) => { records.push({ level: 'info', msg: String(msg), meta }); };
  logger.warn = (msg, meta) => { records.push({ level: 'warn', msg: String(msg), meta }); };
  try { await fn(); } finally { logger.info = o.info; logger.warn = o.warn; }
  return records;
}
const toolResultOutcome = (records, tool) =>
  records.find((r) => r.msg === '[TOOL RESULT]' && r.meta?.tool === tool)?.meta?.outcome;

// ---- frameToolResult ---------------------------------------------------------------------
await check('frameToolResult without a check is exactly today\'s framing (object and string)', () => {
  assert.deepStrictEqual(frameToolResult({ a: 1 }), { content: [{ type: 'text', text: '{"a":1}' }] });
  assert.deepStrictEqual(frameToolResult('plain'), { content: [{ type: 'text', text: 'plain' }] });
  assert.strictEqual('structuredContent' in frameToolResult({ a: 1 }), false);
  assert.strictEqual('isError' in frameToolResult({ a: 1 }), false);
});
await check('frameToolResult valid: structuredContent deep-equals the parsed text block', () => {
  const v = { balance: 5000, accountName: 'Checking', extra: [1, 2] };
  const f = frameToolResult(v, 'valid');
  assert.deepStrictEqual(f.structuredContent, JSON.parse(f.content[0].text));
  assert.strictEqual('isError' in f, false);
});
await check('NEGATIVE frameToolResult mismatch: isError true, no structuredContent, text unchanged', () => {
  const f = frameToolResult({ balance: 'x' }, 'mismatch');
  assert.strictEqual(f.isError, true);
  assert.strictEqual('structuredContent' in f, false);
  assert.strictEqual(f.content[0].text, '{"balance":"x"}');
});

// ---- callToolChecked: accounts_list -------------------------------------------------------
const goodAccounts = [{ id: 'a1', name: 'Checking', offbudget: false, closed: false, balance_current: 12345 }];

await check('accounts_list: valid result is checked valid, and an unlisted upstream field survives', async () => {
  const withExtra = [{ ...goodAccounts[0], brandNewUpstreamField: 'kept' }];
  await withStubs({ getAccountsWithBalances: async () => withExtra }, async () => {
    const r = await manager.callToolChecked('actual_accounts_list', {});
    assert.strictEqual(r.check, 'valid');
    const f = frameToolResult(r.value, r.check);
    assert.strictEqual(f.structuredContent.result[0].brandNewUpstreamField, 'kept');
    assert.deepStrictEqual(f.structuredContent, JSON.parse(f.content[0].text));
    assert.ok(outputJsonSchema(manager.getTool('actual_accounts_list')), 'a published schema exists');
  });
});
await check('NEGATIVE accounts_list: a handler result missing a required field is a mismatch, logged without values', async () => {
  const bad = [{ name: SENTINEL, offbudget: false }]; // no `id`
  let framed;
  const records = await captureLogs(async () => {
    await withStubs({ getAccountsWithBalances: async () => bad }, async () => {
      const r = await manager.callToolChecked('actual_accounts_list', {});
      assert.strictEqual(r.check, 'mismatch');
      framed = frameToolResult(r.value, r.check);
    });
  });
  assert.strictEqual(framed.isError, true);
  assert.strictEqual('structuredContent' in framed, false);
  assert.ok(framed.content[0].text.includes(SENTINEL), 'the text block is returned unchanged');
  const warns = records.filter((r) => r.level === 'warn' && r.meta?.module === 'TOOL_OUTPUT');
  assert.strictEqual(warns.length, 1);
  assert.strictEqual(warns[0].meta.tool, 'actual_accounts_list');
  assert.deepStrictEqual(warns[0].meta.issuePaths, ['result.0.id']);
  assert.ok(!JSON.stringify(records).includes(SENTINEL), 'no result value may reach the logs');
  assert.strictEqual(toolResultOutcome(records, 'actual_accounts_list'), 'output_mismatch');
});
await check('accounts_list: a valid call logs outcome ok, not output_mismatch', async () => {
  const records = await captureLogs(() =>
    withStubs({ getAccountsWithBalances: async () => goodAccounts }, () => manager.callToolChecked('actual_accounts_list', {})));
  assert.strictEqual(toolResultOutcome(records, 'actual_accounts_list'), 'ok');
});

// ---- callToolChecked: accounts_get_balance -------------------------------------------------
const ID = '00000000-0000-4000-8000-000000000001';

await check('get_balance success: structuredContent validates, error absent, integer balance', async () => {
  await withStubs({ getAccounts: async () => [{ id: ID, name: 'Checking' }], getAccountBalance: async () => 5000 }, async () => {
    const r = await manager.callToolChecked('actual_accounts_get_balance', { id: ID });
    assert.strictEqual(r.check, 'valid');
    const f = frameToolResult(r.value, r.check);
    assert.deepStrictEqual(f.structuredContent, { balance: 5000, accountName: 'Checking' });
    assert.strictEqual('error' in f.structuredContent, false);
    assert.ok(Number.isInteger(f.structuredContent.balance));
    assert.strictEqual('isError' in f, false);
  });
});
await check('get_balance missing account: schema-valid { error, balance: null }, no isError, structured equals text', async () => {
  await withStubs({ getAccounts: async () => [] }, async () => {
    const r = await manager.callToolChecked('actual_accounts_get_balance', { id: ID });
    assert.strictEqual(r.check, 'valid');
    const f = frameToolResult(r.value, r.check);
    assert.strictEqual(f.structuredContent.balance, null);
    assert.ok(/not found/i.test(f.structuredContent.error));
    assert.strictEqual('isError' in f, false);
    assert.deepStrictEqual(f.structuredContent, JSON.parse(f.content[0].text));
  });
});
await check('NEGATIVE get_balance: a non-integer balance is a mismatch', async () => {
  await withStubs({ getAccounts: async () => [{ id: ID, name: 'C' }], getAccountBalance: async () => 'oops' }, async () => {
    const r = await manager.callToolChecked('actual_accounts_get_balance', { id: ID });
    assert.strictEqual(r.check, 'mismatch');
    assert.deepStrictEqual(r.issuePaths, ['balance']);
  });
});

// ---- uncovered tool regression (Decision 9) ------------------------------------------------
await check('an uncovered tool: no verdict, byte-identical framing, no outputSchema key in tools/list', async () => {
  await withStubs({ deleteTransaction: async () => ({ success: true }) }, async () => {
    const r = await manager.callToolChecked('actual_transactions_delete', { id: ID });
    assert.strictEqual('check' in r, false);
    const framed = await executeAndFrame(new ActualMCPConnection(), 'actual_transactions_delete', { id: ID });
    assert.deepStrictEqual(framed, { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] });
  });
  const entry = buildToolListEntries(['actual_transactions_delete'], () => ({ description: 'd', outputSchema: undefined }))[0];
  assert.strictEqual(Object.hasOwn(entry, 'outputSchema'), false);
  assert.strictEqual(outputJsonSchema(manager.getTool('actual_transactions_delete')), undefined);
});
await check('callTool still returns only the value (thin wrapper)', async () => {
  await withStubs({ getAccountsWithBalances: async () => goodAccounts }, async () => {
    assert.deepStrictEqual(await manager.callTool('actual_accounts_list', {}), { result: goodAccounts });
  });
});
await check('executeAndFrame through a real connection yields structuredContent for a covered tool', async () => {
  await withStubs({ getAccountsWithBalances: async () => goodAccounts }, async () => {
    const f = await executeAndFrame(new ActualMCPConnection(), 'actual_accounts_list', {});
    assert.deepStrictEqual(f.structuredContent, { result: goodAccounts });
  });
});

// ---- published tools/list ------------------------------------------------------------------
// Every object node of a published schema must stay open: the server-side Zod check strips
// unknown keys, but a client's Ajv check against `additionalProperties: false` would reject an
// unlisted upstream field (for example account_group_id) and fail every call.
function closedObjects(node, path, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((c, i) => closedObjects(c, `${path}[${i}]`, out)); return out; }
  if (node.type === 'object' && node.additionalProperties === false) out.push(path);
  for (const [k, v] of Object.entries(node)) closedObjects(v, `${path}.${k}`, out);
  return out;
}
// Walks a Zod v4 schema's def tree and returns the paths of nodes of the given def type. Used to
// refuse z.record anywhere in an output schema: its keys would reach the mismatch log (#556).
function zodNodesOfType(schema, type, path = 'root', out = [], seen = new Set()) {
  if (!schema?._zod || seen.has(schema)) return out;
  seen.add(schema);
  const def = schema._zod.def;
  if (def.type === type) out.push(path);
  for (const [k, v] of Object.entries(def)) {
    if (k === 'shape' && v && typeof v === 'object') {
      for (const [f, c] of Object.entries(v)) zodNodesOfType(c, type, `${path}.${f}`, out, seen);
    } else if (Array.isArray(v)) {
      v.forEach((c, i) => zodNodesOfType(c, type, `${path}.${k}[${i}]`, out, seen));
    } else if (v?._zod) {
      zodNodesOfType(v, type, `${path}.${k}`, out, seen);
    }
  }
  return out;
}
const published = {};
for (const n of manager.getPublishedToolNames()) {
  const s = outputJsonSchema(manager.getTool(n));
  if (s !== undefined) published[n] = s;
}
const resolve = (name) => {
  const t = manager.getTool(name);
  return { description: t.description, schema: z.toJSONSchema(t.inputSchema), outputSchema: published[name] };
};
const entriesFor = (names) => buildToolListEntries(names, resolve);

await check('exactly the two covered tools publish an outputSchema', () => {
  assert.deepStrictEqual(Object.keys(published).sort(), [...COVERED].sort());
});
await check('every published outputSchema is root type object, non-empty, loose, and not a union', () => {
  for (const [name, s] of Object.entries(published)) {
    assert.strictEqual(s.type, 'object', `${name} root type`);
    assert.ok(s.properties && Object.keys(s.properties).length > 0, `${name} is non-empty`);
    assert.deepStrictEqual(closedObjects(s, name), [], `${name} must be loose at every object node`);
    assert.strictEqual('anyOf' in s || 'oneOf' in s, false, `${name} must not be a union at the root`);
  }
});
await check('every registered outputSchema is a top-level z.object (authoring rule)', () => {
  for (const n of manager.getToolNames()) {
    const t = manager.getTool(n);
    if (!t.outputSchema) continue;
    assert.strictEqual(t.outputSchema._zod.def.type, 'object', `${n} must be a z.object`);
    assert.deepStrictEqual(zodNodesOfType(t.outputSchema, 'record'), [], `${n} must not contain a z.record at any depth`);
  }
});
await check('NEGATIVE: the looseness walk flags a closed nested object', () => {
  const s = z.toJSONSchema(z.object({ items: z.array(z.object({ id: z.string() })) }).loose(), { io: 'output' });
  assert.deepStrictEqual(closedObjects(s, 'fixture'), ['fixture.properties.items.items']);
});
await check('NEGATIVE: the authoring walk finds a z.record nested inside a z.object', () => {
  const schema = z.object({ wrap: z.object({ byAccount: z.record(z.string(), z.number()).optional() }) }).loose();
  assert.strictEqual(zodNodesOfType(schema, 'record').length, 1);
});
await check('the tools/list payload parses with the SDK ListToolsResultSchema', () => {
  const parsed = ListToolsResultSchema.safeParse({ tools: entriesFor(manager.getPublishedToolNames()) });
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 2)));
});
await check('NEGATIVE: a union outputSchema (built with io output) fails the SDK parse', () => {
  const union = z.toJSONSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]), { io: 'output' });
  assert.strictEqual(union.type, undefined, 'a union has no root type');
  const bad = buildToolListEntries(['actual_accounts_list'], () => ({ description: 'd', schema: { type: 'object', properties: {} }, outputSchema: union }));
  assert.strictEqual(ListToolsResultSchema.safeParse({ tools: bad }).success, false);
});
await check('fetchCapabilities publishes outputSchema for covered tools only, and deep-equals the shared builder', async () => {
  const caps = await new ActualMCPConnection().fetchCapabilities();
  const list = caps.tools.list;
  for (const e of list) {
    if (COVERED.includes(e.name)) assert.deepStrictEqual(e.outputSchema, published[e.name], e.name);
    else assert.strictEqual(Object.hasOwn(e, 'outputSchema'), false, e.name);
  }
  assert.ok(ListToolsResultSchema.safeParse({ tools: list }).success);
  for (const name of COVERED) {
    assert.deepStrictEqual(list.find((e) => e.name === name), entriesFor([name])[0], `${name} deep-equals the builder output`);
  }
});

// ---- OpenAI / ECMA-262 compat walk over output schemas --------------------------------------
function patternProblems(node, path, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((c, i) => patternProblems(c, `${path}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'pattern' && typeof v === 'string') {
      if (/\\[pP]\{|\\u\{/.test(v)) out.push(`${path}.pattern uses a u-flag-only escape`);
      else { try { new RegExp(v); } catch { out.push(`${path}.pattern is not a valid regex`); } }
    }
    patternProblems(v, `${path}.${k}`, out);
  }
  return out;
}
await check('published output schemas pass the pattern compat walk (and there is something to walk)', () => {
  assert.ok(Object.keys(published).length > 0);
  for (const [n, s] of Object.entries(published)) assert.deepStrictEqual(patternProblems(s, n), []);
});
await check('NEGATIVE: the walk flags a u-flag-only pattern in an output schema', () => {
  const s = z.toJSONSchema(z.object({ n: z.string().regex(/^[\p{L}]+$/u) }).loose(), { io: 'output' });
  assert.strictEqual(patternProblems(s, 'fixture').length, 1);
});

// ---- both transports, end to end ------------------------------------------------------------
const { createStdioCallToolHandler } = await import('../../dist/src/server/stdioServer.js');
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { startHttpServer } = await import('../../dist/src/server/httpServer.js');

await check('stdio call handler frames a covered tool with structuredContent and an uncovered one without', async () => {
  const handler = createStdioCallToolHandler(new ActualMCPConnection(), 'stdio-test');
  await withStubs({ getAccountsWithBalances: async () => goodAccounts, deleteTransaction: async () => ({ success: true }) }, async () => {
    const cov = await handler({ params: { name: 'actual_accounts_list', arguments: {} } });
    assert.deepStrictEqual(cov.structuredContent, JSON.parse(cov.content[0].text));
    const unc = await handler({ params: { name: 'actual_transactions_delete', arguments: { id: ID } } });
    assert.deepStrictEqual(unc, { content: [{ type: 'text', text: '{"success":true}' }] });
  });
  await withStubs({ getAccountsWithBalances: async () => [{ name: SENTINEL }] }, async () => {
    const bad = await handler({ params: { name: 'actual_accounts_list', arguments: {} } });
    assert.strictEqual(bad.isError, true);
    assert.strictEqual('structuredContent' in bad, false);
  });
});

connectionPool.getConnection = async (sid) => {
  connectionPool.connections.set(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/nonexistent', serverUrl: 'http://localhost:5006', password: 'x', syncId: 'sync-default',
  });
  return connectionPool.connections.get(sid);
};
const { listener, cleanup } = await startHttpServer(
  new ActualMCPConnection(), 0, '/http', {}, [...COVERED, 'actual_transactions_delete'], 'desc', 'instr',
  {}, 'test', '127.0.0.1', undefined, undefined, published,
);
try {
  if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
  const url = `http://127.0.0.1:${listener.address().port}/http`;
  const post = async (body, sid) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    const json = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:')).slice(5));
    return { r, json };
  };
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  const sid = init.r.headers.get('mcp-session-id');
  await check('HTTP tools/list publishes outputSchema for covered tools only, SDK-parsable, deep-equal to the builder', async () => {
    const { json } = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid);
    assert.ok(ListToolsResultSchema.safeParse(json.result).success);
    for (const e of json.result.tools) {
      if (COVERED.includes(e.name)) assert.deepStrictEqual(e.outputSchema, published[e.name], e.name);
      else assert.strictEqual(Object.hasOwn(e, 'outputSchema'), false, e.name);
    }
  });
  await check('HTTP tools/call keeps the verdict: structuredContent, isError on mismatch, plain for uncovered', async () => {
    await withStubs({ getAccountsWithBalances: async () => goodAccounts, deleteTransaction: async () => ({ success: true }) }, async () => {
      const ok = (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'actual_accounts_list', arguments: {} } }, sid)).json.result;
      assert.deepStrictEqual(ok.structuredContent, JSON.parse(ok.content[0].text));
      assert.deepStrictEqual(ok.structuredContent, { result: goodAccounts });
      const unc = (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'actual_transactions_delete', arguments: { id: ID } } }, sid)).json.result;
      assert.deepStrictEqual(unc, { content: [{ type: 'text', text: '{"success":true}' }] });
    });
    await withStubs({ getAccountsWithBalances: async () => [{ name: SENTINEL }] }, async () => {
      const bad = (await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'actual_accounts_list', arguments: {} } }, sid)).json.result;
      assert.strictEqual(bad.isError, true);
      assert.strictEqual('structuredContent' in bad, false);
    });
  });
} finally {
  await new Promise((res) => listener.close(res));
  process.removeListener('SIGTERM', cleanup);
  process.removeListener('SIGINT', cleanup);
}

console.log(`\n[#642] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
