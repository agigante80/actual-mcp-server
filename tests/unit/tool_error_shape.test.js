// #769: a tool EXECUTION failure is a result with isError: true (MCP 2025-11-25, Tools, Error
// Handling), so a model can read it and retry. A PROTOCOL fault is a JSON-RPC error: an unknown
// tool and a malformed tools/call envelope are -32602 with a value-free message, a server wiring
// fault stays -32603.
//
// Both transports are driven over a real JSON-RPC wire: stdio through an in-memory Server that
// registers exactly what startStdioServer registers (createStdioCallToolHandler through
// registerToolCallHandler), HTTP through startHttpServer. The two assumptions the ticket asked
// this test to settle are pinned at the end:
//   1. a loose request schema alone still leaves the SDK's own tools/call wrapper to answer with
//      a Zod dump (probed on the installed SDK), so the handler is registered one layer down;
//   2. the dump never carries a received value (checked on the wire with a sentinel).
//
// Run: node tests/unit/tool_error_shape.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, CallToolResultSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

const errors = await import('../../dist/src/lib/errors.js');
const toolOutput = await import('../../dist/src/lib/tool-output.js');
const { registerToolCallHandler } = await import('../../dist/src/lib/register-tool-call.js');
const { markInitFailure, classifyInitFailure } = await import('../../dist/src/lib/init-failure.js');
const { createStdioCallToolHandler } = await import('../../dist/src/server/stdioServer.js');
const { startHttpServer } = await import('../../dist/src/server/httpServer.js');
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { default: manager } = await import('../../dist/src/actualToolsManager.js');

let passed = 0;
let failed = 0;
const log = (s) => process.stderr.write(s + '\n');
async function check(name, fn) {
  try { await fn(); log(`  ok: ${name}`); passed++; }
  catch (err) { log(`  FAIL: ${name}\n    ${err.stack ?? err.message}`); failed++; }
}

const SENTINEL = 'SENTINEL-769-VALUE';
const ID = '00000000-0000-4000-8000-000000000000';

// ---- the failures a tool can raise, and what each must become ----------------------------------
const apiError = { type: 'APIError', message: 'No budget exists for month: 2026-13', meta: { secret: SENTINEL } };
const withExtras = Object.assign(new Error('plain failure message'), {
  cause: new Error(`CAUSE-${SENTINEL}`),
  data: `DATA-${SENTINEL}`,
});
withExtras.stack = `Error: plain failure message\n    at /home/someone/STACK-${SENTINEL}.js:1:1`;

const CLASSES = [
  ['a plain Error (read-only query refusal)', () => new Error('Query execution failed: run_query is read-only'), 'Query execution failed: run_query is read-only'],
  ['a #206 Validation error', () => new Error('Validation error: type: allowed values: account, tag'), 'Validation error: type: allowed values: account, tag'],
  ['a NotFoundRefusal', () => new errors.NotFoundRefusal('Tag', ID, 'list_entities with type tag'), null],
  ['an OutOfRangeRefusal', () => new errors.OutOfRangeRefusal('Month 2026-13 is out of range', '2026-13'), 'Month 2026-13 is out of range'],
  ['a ConflictRefusal', () => new errors.ConflictRefusal('A tag with that name already exists'), 'A tag with that name already exists'],
  ['a LockedRefusal', () => new errors.LockedRefusal('sync-1'), null],
  ['a ToolUnavailableError', () => new errors.ToolUnavailableError('actual_bank_sync', 'MCP_TOOLSETS'), null],
  ['an upstream APIError-like object', () => apiError, 'No budget exists for month: 2026-13'],
  ['an Error that carries a stack, a cause and data', () => withExtras, 'plain failure message'],
  ['a "Tool not found" Error that is NOT an UnknownToolError', () => new Error('Tool not found: x'), 'Tool not found: x'],
  ['a thrown string', () => 'boom', 'Tool call failed'],
  ['a thrown null', () => null, 'Tool call failed'],
];

function expectedText(make, fixed) {
  if (fixed !== null) return fixed;
  const e = make();
  return e.message;
}

// ---- transport 1: stdio handler on an in-memory JSON-RPC wire ----------------------------------
async function stdioWire(executor) {
  const server = new Server({ name: 't', version: '0' }, { capabilities: { tools: {} } });
  registerToolCallHandler(server, createStdioCallToolHandler(executor, 'stdio-test'));
  const client = new Client({ name: 'c', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const call = async (params) => {
    try {
      return { result: await client.request({ method: 'tools/call', params }, z.looseObject({}), { timeout: 5000 }) };
    } catch (err) {
      return { error: { code: err.code, message: err.message } };
    }
  };
  return { call, close: () => client.close() };
}

// ---- transport 2: the real HTTP server ---------------------------------------------------------
connectionPool.getConnection = async (sid) => {
  connectionPool.connections.set(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/nonexistent', serverUrl: 'http://localhost:5006', password: 'x', syncId: 'sync-default',
  });
  return connectionPool.connections.get(sid);
};
let httpBehaviour = async () => ({ ok: true });
const httpMcp = { executeTool: async (n, a) => httpBehaviour(n, a) };
const { listener, cleanup } = await startHttpServer(
  httpMcp, 0, '/http', {}, ['list_entities'], 'desc', 'instr', {}, 'test', '127.0.0.1',
);
const httpWire = async () => {
  if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
  const url = `http://127.0.0.1:${listener.address().port}/http`;
  const post = async (body, sid) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await r.text();
    const json = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:')).slice(5));
    return { r, json };
  };
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  const sid = init.r.headers.get('mcp-session-id');
  let id = 10;
  return {
    call: async (params) => {
      const { json } = await post({ jsonrpc: '2.0', id: id++, method: 'tools/call', params }, sid);
      return json.error ? { error: json.error } : { result: json.result };
    },
  };
};

try {
  const http = await httpWire();
  const wires = [
    ['stdio', (executor) => stdioWire(executor), 'stdio'],
    ['http', async (behaviour) => { httpBehaviour = behaviour.executeTool; return { call: http.call, close: async () => {} }; }, 'http'],
  ];

  for (const [label, open] of wires) {
    log(`\n[#769] ${label}: execution failures are isError results`);
    for (const [what, make, fixed] of CLASSES) {
      await check(`${label}: ${what} becomes an isError result with the message text and no error member`, async () => {
        const w = await open({ executeTool: async () => { throw make(); } });
        const r = await w.call({ name: 'list_entities', arguments: {} });
        await w.close();
        assert.strictEqual(r.error, undefined, `no JSON-RPC error expected, got ${JSON.stringify(r.error)}`);
        assert.strictEqual(r.result.isError, true);
        assert.deepStrictEqual(Object.keys(r.result).sort(), ['content', 'isError']);
        assert.deepStrictEqual(r.result.content, [{ type: 'text', text: expectedText(make, fixed) }]);
        assert.ok(CallToolResultSchema.safeParse(r.result).success, 'must parse as a CallToolResult');
      });
    }

    await check(`${label}: nothing but error.message is forwarded (no stack, cause or data)`, async () => {
      const w = await open({ executeTool: async () => { throw withExtras; } });
      const r = await w.call({ name: 'list_entities', arguments: {} });
      await w.close();
      const wire = JSON.stringify(r);
      assert.ok(!wire.includes(SENTINEL), `a sentinel from stack, cause or data reached the client: ${wire}`);
      assert.ok(!wire.includes('/home/someone'), 'a stack frame path reached the client');
      assert.ok(!wire.includes('at '), 'a stack frame reached the client');
    });

    await check(`${label}: an unclassified error message is not written to the logs by the helper`, async () => {
      const chunks = [];
      const wrap = (stream) => { const orig = stream.write; stream.write = (c, ...rest) => { chunks.push(String(c)); return orig.call(stream, c, ...rest); }; return () => { stream.write = orig; }; };
      const un1 = wrap(process.stdout); const un2 = wrap(process.stderr);
      const w = await open({ executeTool: async () => { throw new Error(`LOGLEAK-${SENTINEL}`); } });
      const r = await w.call({ name: 'list_entities', arguments: {} });
      await w.close();
      un1(); un2();
      assert.ok(JSON.stringify(r).includes(`LOGLEAK-${SENTINEL}`), 'the client still receives the message');
      assert.ok(!chunks.join('').includes(`LOGLEAK-${SENTINEL}`), 'the message must not reach any log line');
    });

    log(`\n[#769] ${label}: protocol faults are JSON-RPC errors`);
    await check(`${label}: an UnknownToolError is -32602 "Unknown tool: <name>", never an isError result`, async () => {
      const w = await open({ executeTool: async (name) => { throw new errors.UnknownToolError(name); } });
      const r = await w.call({ name: 'no_such_tool', arguments: {} });
      await w.close();
      assert.strictEqual(r.result, undefined);
      assert.strictEqual(r.error.code, -32602);
      assert.ok(/Unknown tool: no_such_tool$/.test(r.error.message), r.error.message);
    });

    await check(`${label}: an unknown tool name is cut to 64 characters and stripped of control characters`, async () => {
      const w = await open({ executeTool: async (name) => { throw new errors.UnknownToolError(name); } });
      const r = await w.call({ name: `a\u0007b\n${'x'.repeat(200)}`, arguments: {} });
      await w.close();
      assert.strictEqual(r.error.code, -32602);
      const shown = r.error.message.slice(r.error.message.indexOf('Unknown tool: ') + 'Unknown tool: '.length);
      assert.ok(shown.length <= 64, `name must be cut to 64, got ${shown.length}`);
      assert.ok(!/[\u0000-\u001f]/.test(shown), 'no control character may be echoed');
      assert.ok(shown.startsWith('ab'));
    });

    const MALFORMED = [
      ['arguments is a string', { name: 'list_entities', arguments: `type=${SENTINEL}` }, '"arguments" must be an object'],
      ['arguments is null', { name: 'list_entities', arguments: null }, '"arguments" must be an object'],
      ['arguments is an array', { name: 'list_entities', arguments: [SENTINEL] }, '"arguments" must be an object'],
      ['arguments is a number', { name: 'list_entities', arguments: 7 }, '"arguments" must be an object'],
      ['name is absent', {}, '"name" must be a string'],
      ['name is a number', { name: 123, arguments: {} }, '"name" must be a string'],
    ];
    for (const [what, params, fragment] of MALFORMED) {
      await check(`${label}: malformed envelope (${what}) is -32602 with a fixed, value-free message`, async () => {
        const w = await open({ executeTool: async () => { throw new Error('the executor must not run'); } });
        const r = await w.call(params);
        await w.close();
        assert.strictEqual(r.result, undefined, `expected a protocol error, got ${JSON.stringify(r.result)}`);
        assert.strictEqual(r.error.code, -32602);
        assert.ok(r.error.message.includes(`Invalid tools/call params: ${fragment}`), r.error.message);
        assert.ok(!r.error.message.includes('[') && !r.error.message.includes('invalid_type'), 'no Zod dump');
        assert.ok(!r.error.message.includes(SENTINEL) && !r.error.message.includes('type='), 'no received value');
        assert.ok(!/-32602.*-32602/.test(r.error.message), 'the code prefix must not be doubled by us');
      });
    }

    await check(`${label}: omitted arguments still dispatch {} (#510)`, async () => {
      let received = 'not called';
      const w = await open({ executeTool: async (_n, a) => { received = a; return { ok: true }; } });
      const r = await w.call({ name: 'list_entities' });
      await w.close();
      assert.deepStrictEqual(received, {});
      assert.strictEqual(r.result.isError, undefined);
    });

    await check(`${label}: a success is not an error`, async () => {
      const w = await open({ executeTool: async () => ({ ok: true }) });
      const r = await w.call({ name: 'list_entities', arguments: {} });
      await w.close();
      assert.deepStrictEqual(r.result, { content: [{ type: 'text', text: '{"ok":true}' }] });
    });
  }

  log('\n[#769] the executor-missing wiring fault stays -32603');
  await check('stdio: a connection without an executor is -32603, not an isError result', async () => {
    const w = await stdioWire({});
    const r = await w.call({ name: 'list_entities', arguments: {} });
    await w.close();
    assert.strictEqual(r.result, undefined);
    assert.strictEqual(r.error.code, -32603);
    assert.ok(/Tool executor not available for list_entities/.test(r.error.message), r.error.message);
  });
  await check('http: a connection without an executor is -32603, not an isError result', async () => {
    const saved = httpMcp.executeTool;
    delete httpMcp.executeTool;
    try {
      const r = await http.call({ name: 'list_entities', arguments: {} });
      assert.strictEqual(r.result, undefined);
      assert.strictEqual(r.error.code, -32603);
      assert.ok(/Tool executor not available for list_entities/.test(r.error.message), r.error.message);
    } finally {
      httpMcp.executeTool = saved;
    }
  });

  log('\n[#769] the stdio init failure sentence is byte identical');
  await check('a branded init failure is still the fixed #438 sentence on stdio', async () => {
    const err = markInitFailure(Object.assign(new Error(`UPSTREAM-${SENTINEL}`), { code: 'invalid-schema' }));
    const w = await stdioWire({ executeTool: async () => { throw err; } });
    const r = await w.call({ name: 'list_entities', arguments: {} });
    await w.close();
    assert.deepStrictEqual(r.result, { isError: true, content: [{ type: 'text', text: classifyInitFailure(err).sentence }] });
  });
  await check('a branded init failure is the SAME fixed sentence on http, with no upstream host or port', async () => {
    const err = markInitFailure(Object.assign(new Error('request to http://10.20.30.40:5006/account/login failed, reason: connect ECONNREFUSED 10.20.30.40:5006'), { code: 'ECONNREFUSED' }));
    const saved = httpBehaviour;
    httpBehaviour = async () => { throw err; };
    try {
      const hr = await http.call({ name: 'list_entities', arguments: {} });
      const w = await stdioWire({ executeTool: async () => { throw err; } });
      const sr = await w.call({ name: 'list_entities', arguments: {} });
      await w.close();
      assert.ok(!JSON.stringify(hr.result).includes('10.20.30.40'), `http leaked the upstream host: ${JSON.stringify(hr.result)}`);
      assert.deepStrictEqual(hr.result, { isError: true, content: [{ type: 'text', text: classifyInitFailure(err).sentence }] });
      assert.deepStrictEqual(hr.result.content, sr.result.content, 'transports must return byte-identical content');
    } finally {
      httpBehaviour = saved;
    }
  });
  await check('NEGATIVE: an unbranded error with init-looking prose is NOT replaced by the sentence', async () => {
    const w = await stdioWire({ executeTool: async () => { throw new Error('Authentication failed: Too many requests'); } });
    const r = await w.call({ name: 'list_entities', arguments: {} });
    await w.close();
    assert.strictEqual(r.result.content[0].text, 'Authentication failed: Too many requests');
  });

  log('\n[#769] the manager throws the typed UnknownToolError');
  await manager.initialize();
  await check('callToolChecked of an unregistered name rejects with an UnknownToolError that keeps the old text', async () => {
    let caught;
    try { await manager.callToolChecked('no_such_tool', {}); } catch (e) { caught = e; }
    assert.ok(caught instanceof errors.UnknownToolError, `got ${caught && caught.constructor.name}`);
    assert.strictEqual(caught.tool, 'no_such_tool');
    assert.strictEqual(caught.message, 'Tool not found: no_such_tool');
  });
  await check('callOperation of an unregistered legacy name rejects with an UnknownToolError', async () => {
    let caught;
    try { await manager.callOperation('no_such_tool', {}); } catch (e) { caught = e; }
    assert.ok(caught instanceof errors.UnknownToolError, `got ${caught && caught.constructor.name}`);
  });

  log('\n[#769] the two ticket assumptions, pinned on the installed SDK');
  await check('ASSUMPTION 1: a loose schema through the SDK Server wrapper still answers a Zod dump', async () => {
    // Why registerToolCallHandler bypasses Server.setRequestHandler. If this goes red, the SDK
    // changed and the bypass may no longer be needed: re-read src/lib/tool-output.ts first.
    const server = new Server({ name: 't', version: '0' }, { capabilities: { tools: {} } });
    const Loose = z.object({ method: z.literal('tools/call'), params: z.looseObject({ name: z.unknown().optional(), arguments: z.unknown().optional() }).optional() });
    server.setRequestHandler(Loose, async () => ({ content: [] }));
    const client = new Client({ name: 'c', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    let err;
    try { await client.request({ method: 'tools/call', params: { name: 'x', arguments: 'str' } }, z.looseObject({}), { timeout: 5000 }); } catch (e) { err = e; }
    await client.close();
    assert.ok(err instanceof McpError && err.code === -32602);
    assert.ok(/invalid_type|\[/.test(err.message), `expected the SDK dump, got: ${err.message}`);
  });
  await check('ASSUMPTION 2: the SDK dump carries a path and a type, not the received value', async () => {
    const parsed = CallToolRequestSchema.safeParse({ method: 'tools/call', params: { name: 'x', arguments: `type=${SENTINEL}` } });
    assert.strictEqual(parsed.success, false);
    assert.ok(!JSON.stringify(parsed.error.issues).includes(SENTINEL), 'the issue list must not carry the value');
  });

  log('\n[#769] helper unit rows');
  await check('parseToolCallEnvelope returns name and args, and defaults omitted arguments to {}', () => {
    assert.deepStrictEqual(toolOutput.parseToolCallEnvelope({ name: 'a', arguments: { x: 1 } }), { name: 'a', args: { x: 1 } });
    assert.deepStrictEqual(toolOutput.parseToolCallEnvelope({ name: 'a' }), { name: 'a', args: {} });
  });
  await check('NEGATIVE: parseToolCallEnvelope throws a -32602 error for a non-object params', () => {
    for (const bad of [undefined, null, 'x', 5]) {
      assert.throws(() => toolOutput.parseToolCallEnvelope(bad), (e) => e.code === -32602);
    }
  });
} finally {
  await new Promise((res) => listener.close(res));
  process.removeListener('SIGTERM', cleanup);
  process.removeListener('SIGINT', cleanup);
}

console.log(`\n[#769] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
