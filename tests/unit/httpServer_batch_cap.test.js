// tests/unit/httpServer_batch_cap.test.js
//
// #500: @modelcontextprotocol/sdk 1.30.1 caps a JSON-RPC batch at 100 messages on the
// Streamable HTTP transport (400, -32600). On 1.30.0 a 101-message batch was accepted,
// so this file is red on the old SDK and green on the new one.
//
// Three prongs, matching the repo convention (unit tests never boot httpServer.ts):
//   1. Behavioural (U1, U2): a STATEFUL harness built with production's transport
//      options (randomUUID session ids, enableJsonResponse) and production's call
//      shape, handleRequest(req, res, req.body), so the cap is asserted on the
//      pre-parsed body path we actually use. The SDK skips its own body reader on
//      that path, which is why our body bound stays MCP_HTTP_BODY_LIMIT.
//   2. Wiring (U3, U5): source guards that the session-bearing POST call still passes
//      req.body, and that a session-less array is refused by OUR handler before the
//      SDK ever sees it (an array has no `method`).
//   3. Version floor (U4): both the installed SDK and the declared range, because npm
//      consumers resolve the range and never see our lockfile.
//
// Run: node tests/unit/httpServer_batch_cap.test.js

import assert from 'assert';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// --- Behavioural harness ---------------------------------------------------------
const transports = new Map();
const app = express();
app.use(express.json({ limit: '512kb' }));
app.post('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  let transport = sid ? transports.get(sid) : undefined;
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => transports.set(id, transport),
    });
    await new McpServer({ name: 'batch-cap-test', version: '0.0.0' }).connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
});
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/mcp`;

const BASE_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
async function post(body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { ...BASE_HEADERS, ...headers }, body: JSON.stringify(body) });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const init = await post({
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
});
const sessionId = init.headers.get('mcp-session-id');
const protocolVersion = JSON.parse(init.text).result?.protocolVersion;
const SESSION_HEADERS = { 'mcp-session-id': sessionId, 'mcp-protocol-version': protocolVersion };
const pings = (n) => Array.from({ length: n }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'ping' }));

console.log('\n[httpServer batch cap]');

await check('harness: initialize returned a session id (so U1/U2 run on the session-bearing path)', () => {
  assert.strictEqual(init.status, 200, `initialize answered ${init.status}: ${init.text.slice(0, 200)}`);
  assert.ok(sessionId, 'no mcp-session-id header on the initialize response');
});

await check('U1 NEGATIVE: 101 messages in one session-bearing batch are refused with 400 / -32600', async () => {
  const r = await post(pings(101), SESSION_HEADERS);
  assert.strictEqual(r.status, 400, `expected 400, got ${r.status}: ${r.text.slice(0, 200)}`);
  const body = JSON.parse(r.text);
  assert.strictEqual(body.error?.code, -32600);
  assert.match(body.error?.message ?? '', /Batch must not exceed 100/);
});

await check('U2 POSITIVE: 100 messages in one session-bearing batch are not refused by the cap', async () => {
  const r = await post(pings(100), SESSION_HEADERS);
  assert.doesNotMatch(r.text, /Batch must not exceed/);
  assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.text.slice(0, 200)}`);
});

server.close();

// --- Wiring guards ---------------------------------------------------------------
const SRC = readFileSync(join(ROOT, 'src/server/httpServer.ts'), 'utf8');

// The body of the `{ ... }` block whose opening brace is the first one at or after `from`.
function blockAt(text, from) {
  const open = text.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

const BODY_CALL = 'handleRequest(req, res, req.body)';

await check('U3: exactly two POST-path calls pass req.body, one inside the session-bearing requestContext.run', () => {
  const count = SRC.split(BODY_CALL).length - 1;
  assert.strictEqual(count, 2, `expected 2 calls to ${BODY_CALL}, found ${count}; update this test if a new body-passing path is intended`);
  const runAt = SRC.indexOf('requestContext.run({ sessionId, ');
  assert.ok(runAt >= 0, 'the session-bearing requestContext.run({ sessionId, ... }) call is gone');
  const callback = blockAt(SRC, SRC.indexOf('=>', runAt));
  assert.ok(callback?.includes(BODY_CALL), `the session-bearing block no longer calls ${BODY_CALL}`);
});

await check('U5: a session-less POST that is not initialize/tools/list is refused with 400 / -32000 before the SDK', () => {
  assert.match(SRC, /const method = payload\?\.method;/,
    'method is no longer read as payload?.method, so an array may not yield an undefined method');
  const branch = blockAt(SRC, SRC.indexOf('if (!sessionId) {'));
  assert.ok(branch, 'the if (!sessionId) branch is gone');
  assert.match(branch, /method !== 'initialize' && method !== 'tools\/list'/);
  assert.match(branch, /res\.status\(400\)/);
  assert.match(branch, /code: -32000/);
});

// --- Version floor ---------------------------------------------------------------
const FLOOR = [1, 30, 1];
function atLeast(version, floor) {
  const parts = String(version).replace(/^[^\d]*/, '').split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}

await check('U4: the installed SDK and the declared range floor are both at least 1.30.1', () => {
  // Read by path: the SDK's `./*` export maps `package.json` to dist/cjs/package.json, which has no version.
  const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version;
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies['@modelcontextprotocol/sdk'];
  assert.ok(atLeast(installed, FLOOR), `installed SDK is ${installed}`);
  assert.ok(atLeast(declared, FLOOR), `package.json declares ${declared}; npm consumers resolve this range`);
});

await check('U4 NEGATIVE: the floor compare refuses what it must', () => {
  assert.strictEqual(atLeast('1.30.0', FLOOR), false);
  assert.strictEqual(atLeast('^1.30.0', FLOOR), false);
  assert.strictEqual(atLeast('1.9.9', FLOOR), false);
  assert.strictEqual(atLeast('^1.30.1', FLOOR), true);
  assert.strictEqual(atLeast('1.31.0', FLOOR), true);
  assert.strictEqual(atLeast('2.0.0', FLOOR), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
