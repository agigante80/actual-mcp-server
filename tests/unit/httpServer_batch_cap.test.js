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
//   2. Wiring (U3a, U5c): source guards, run on comment-stripped source (#503), that the
//      session-bearing POST call still passes req.body, and that a session-less array is
//      refused by OUR handler before the SDK ever sees it (an array has no `method`).
//      U3b, U3c, U5a, U5b and U5b2 are mutation fixtures proving each predicate can fail;
//      W1 proves a multi-line reformat still passes.
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
import { stripTsComments } from './helpers/source-text.js';
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

// Predicates run on COMMENT-STRIPPED text (#503), so a comment holding the guarded text cannot
// satisfy a guard. Each returns an array of violation strings, empty when the property holds,
// and the negative fixtures below run through the SAME predicates to prove they can fail.
const CALL_SRC = String.raw`\btransport\.handleRequest\(\s*req\s*,\s*res\s*,\s*req\.body\s*,?\s*\)`;

function u3Violations(text) {
  const out = [];
  const count = (text.match(new RegExp(CALL_SRC, 'g')) || []).length;
  if (count !== 2) {
    out.push(`expected 2 calls passing req.body, found ${count}; update this test if a new body-passing path is intended`);
  }
  // `sessionId,` does not match the session-less `sessionId: undefined` run.
  const run = /requestContext\.run\(\s*\{\s*sessionId\s*,/.exec(text);
  if (!run) {
    out.push('the session-bearing requestContext.run({ sessionId, ... }) call is gone');
  } else {
    const callback = blockAt(text, text.indexOf('=>', run.index));
    if (!callback || !new RegExp(CALL_SRC).test(callback)) {
      out.push('the session-bearing requestContext.run block no longer passes req.body to handleRequest');
    }
  }
  return out;
}

// Deliberate exact pin: "payload does not unwrap an array" cannot be stated as a denylist
// ([0], .at(, .find(, destructuring, ...) without gaps, so the initializer is compared exactly
// (whitespace removed). A benign refactor of this line reads as an intended test update.
const PAYLOAD_PIN = '(req.body&&Object.keys(req.body).length)?req.body:{}';

function u5Violations(text) {
  const out = [];
  const payload = text.match(/\bconst\s+payload\s*=\s*([^;]+);/);
  if (!payload) out.push('payload: the const payload declaration is gone');
  else if (payload[1].replace(/\s+/g, '') !== PAYLOAD_PIN) out.push('payload: the initializer changed, it may now unwrap an array');
  if (!/\bconst\s+method\s*=\s*payload\?\.method\s*;/.test(text)) {
    out.push('method: no longer read as payload?.method, so an array may not yield an undefined method');
  }
  const branch = blockAt(text, text.search(/\bif\s*\(\s*!sessionId\s*\)\s*\{/));
  if (!branch) return [...out, 'branch: the if (!sessionId) branch is gone'];
  // The WHOLE condition: a `false &&` prefix or `&& false` suffix must not match.
  const cond = /\bif\s*\(\s*method\s*!==\s*'initialize'\s*&&\s*method\s*!==\s*'tools\/list'\s*\)\s*\{/.exec(branch);
  if (!cond) return [...out, 'condition: the refusal condition is not exactly method !== initialize && method !== tools/list'];
  const refusal = blockAt(branch, cond.index);
  if (!refusal || !/res\.status\(\s*400\s*\)/.test(refusal)) out.push('refusal: no res.status(400) in the refusal block');
  if (!refusal || !/code:\s*-32000/.test(refusal)) out.push('refusal: no code -32000 in the refusal block');
  return out;
}

const STRIPPED = stripTsComments(SRC);

// Build a fixture by text replacement on the real source; fail loudly if the anchor drifted,
// so a stale anchor cannot make a negative fixture vacuous.
function mutate(anchor, replacement) {
  const m = SRC.replace(anchor, replacement);
  assert.notStrictEqual(m, SRC, `fixture anchor not found: ${anchor.slice(0, 60)}`);
  return stripTsComments(m);
}

const PAYLOAD_LINE = "const payload = (req.body && Object.keys(req.body).length) ? req.body : {};";
const COND_LINE = "if (method !== 'initialize' && method !== 'tools/list') {";
const BODY_STMT = 'await transport.handleRequest(req, res, req.body);';
const SESSION_RUN = `requestContext.run({ sessionId, requestId, allowedBudgets, principal: resolvePrincipal(req) }, async () => {\n        ${BODY_STMT}\n      });`;

await check('U3a: exactly two POST-path calls pass req.body, one inside the session-bearing requestContext.run (comments stripped)', () => {
  assert.deepStrictEqual(u3Violations(STRIPPED), []);
});

await check('U3b NEGATIVE: a sliced call with the original text kept only in a trailing comment is reported', () => {
  const v = u3Violations(mutate(SESSION_RUN, SESSION_RUN.replace(BODY_STMT,
    'await transport.handleRequest(req, res, Array.isArray(req.body) ? req.body.slice(0, 1) : req.body); // transport.handleRequest(req, res, req.body)')));
  assert.ok(v.length > 0, 'a comment decoy must not satisfy U3');
});

await check('U3c NEGATIVE: the body-passing call moved out of the session-bearing run (count still 2) is reported', () => {
  const v = u3Violations(mutate(SESSION_RUN, SESSION_RUN.replace(BODY_STMT, 'await transport.handleRequest(req, res);') + `\n      ${BODY_STMT}`));
  assert.ok(v.length > 0, 'a call outside the session-bearing block must not satisfy U3');
});

await check('U5c: a session-less POST that is not initialize/tools/list is refused with 400 / -32000 before the SDK (comments stripped)', () => {
  assert.deepStrictEqual(u5Violations(STRIPPED), []);
});

await check('U5a NEGATIVE: a payload that unwraps an array is reported', () => {
  const v = u5Violations(mutate(PAYLOAD_LINE,
    'const payload = Array.isArray(req.body) ? req.body[0] ?? {} : ((req.body && Object.keys(req.body).length) ? req.body : {});'));
  assert.ok(v.some((x) => x.startsWith('payload')), v.join('; '));
});

await check('U5b NEGATIVE: a `false &&` prefix on the refusal condition is reported', () => {
  const v = u5Violations(mutate(COND_LINE, "if (false && method !== 'initialize' && method !== 'tools/list') {"));
  assert.ok(v.some((x) => x.startsWith('condition')), v.join('; '));
});

await check('U5b2 NEGATIVE: a `&& false` suffix on the refusal condition is reported', () => {
  const v = u5Violations(mutate(COND_LINE, "if (method !== 'initialize' && method !== 'tools/list' && false) {"));
  assert.ok(v.some((x) => x.startsWith('condition')), v.join('; '));
});

await check('W1: the guarded expressions reformatted over several lines still pass both predicates', () => {
  let m = SRC;
  for (const [anchor, rep] of [
    [PAYLOAD_LINE, 'const payload = (\n      req.body &&\n      Object.keys(req.body).length\n    ) ? req.body : {};'],
    [COND_LINE, "if (\n        method !== 'initialize' &&\n        method !== 'tools/list'\n      ) {"],
    [SESSION_RUN, SESSION_RUN.replace('handleRequest(req, res, req.body);', 'handleRequest(\n          req,\n          res,\n          req.body,\n        );')],
  ]) {
    const next = m.replace(anchor, rep);
    assert.notStrictEqual(next, m, `fixture anchor not found: ${anchor.slice(0, 60)}`);
    m = next;
  }
  const t = stripTsComments(m);
  assert.deepStrictEqual(u3Violations(t), []);
  assert.deepStrictEqual(u5Violations(t), []);
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
