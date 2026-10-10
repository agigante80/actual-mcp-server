// tests/unit/httpErrorHandler.test.js
//
// #543: the final Express error layer (src/server/httpErrorHandler.ts). express 5.3.0's
// default handler logs the WHOLE error object, and body-parser 2.3.0 attaches the raw
// request text as err.body, so without this layer an unauthenticated malformed POST lands
// in the logs. Pinned here, against minimal apps with the production wiring shape:
//   - malformed JSON on the MCP path: 400 + JSON-RPC -32700, id null;
//   - malformed JSON elsewhere: 400 + plain {error}, no jsonrpc key;
//   - the MCP-path match is exact (/mcp-info is not /mcp; /mcp?x=1 is) but case-insensitive like Express routing (/MCP is);
//   - oversize: 413; other exposed body-parser 4xx (415, corrupt gzip 400) keep their status;
//   - a thrown error: a fixed 500, even under NODE_ENV=development;
//   - the request text (a sentinel) never reaches the response or the logs;
//   - after headers are sent: the socket is destroyed and next() is never called.
// A positive control proves the log capture CAN see the sentinel, and controls without the
// handler prove the default handler is what leaks (so the assertions are not vacuous).
//
// The harness must NOT run under NODE_ENV=test: express logerror is silent then, which
// would make the no-handler control prove nothing.
//
// Run: node tests/unit/httpErrorHandler.test.js

import http from 'node:http';
import { createRequire } from 'node:module';

if (process.env.NODE_ENV === 'test') delete process.env.NODE_ENV;
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

const require = createRequire(import.meta.url);
const express = require('express');
const expressVersion = require('express/package.json').version;
const { createHttpErrorHandler } = await import('../../dist/src/server/httpErrorHandler.js');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { process.stderr.write(`  ok: ${label}\n`); passed++; }
  else { process.stderr.write(`  FAIL: ${label}${detail ? ` (${String(detail).slice(0, 400)})` : ''}\n`); failed++; }
}

const SENTINEL = 'SENTINEL-543';
const MALFORMED = `{"jsonrpc":"2.0","method":"tools/call","params":{"note":"${SENTINEL} Bearer eyJfake"`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Capture everything the process logs while fn runs: stdout, stderr and console.error (the
// logger rewires console.* into winston, which writes to stdout outside stdio mode).
async function captured(fn) {
  const chunks = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origConsoleError = console.error;
  process.stdout.write = (c, ...a) => { chunks.push(String(c)); return origOut(c, ...a); };
  process.stderr.write = (c, ...a) => { chunks.push(String(c)); return origErr(c, ...a); };
  console.error = (...args) => { chunks.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')); };
  try {
    const result = await fn();
    await sleep(50); // let winston flush
    return { result, logs: chunks.join('') };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    console.error = origConsoleError;
  }
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json };
}

function buildApp({ withHandler = true, mcpPath = '/mcp', echo = false } = {}) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/{*rest}', (_req, res) => res.json({ ok: true }));
  app.get('/boom', () => { throw new Error(`${SENTINEL} thrown at /home/someone/app/file.js:12:3`); });
  // A status WITHOUT expose is not trusted: it stays a 500.
  app.get('/unexposed', () => { throw Object.assign(new Error(SENTINEL), { status: 404 }); });
  if (echo) {
    // Positive control for the capture: a handler that DOES log the body.
    app.use((err, _req, res, _next) => { console.error(`echo ${err.body}`); res.status(400).end(); });
  }
  if (withHandler) app.use(createHttpErrorHandler({ mcpPath }));
  return app;
}

console.log(`\n[#543] httpErrorHandler (express ${expressVersion})`);

{
  const { server, base } = await listen(buildApp());
  try {
    const mcp = await captured(() => post(base, '/mcp', MALFORMED));
    const r = mcp.result;
    check('malformed POST to the MCP path -> 400', r.status === 400, r.status);
    check('-> JSON-RPC -32700 Parse error with id null',
      r.json?.jsonrpc === '2.0' && r.json?.error?.code === -32700 && r.json?.error?.message === 'Parse error' && r.json?.id === null, r.text);
    check('the sentinel is absent from the MCP response', !r.text.includes(SENTINEL), r.text);
    check('the sentinel is absent from the logs (MCP path)', !mcp.logs.includes(SENTINEL), mcp.logs);
    check('the rejection is logged with its type', mcp.logs.includes('entity.parse.failed'), mcp.logs);

    const health = await captured(() => post(base, '/health', MALFORMED));
    check('malformed POST to /health -> 400 with a plain body and no jsonrpc key',
      health.result.status === 400 && health.result.json?.error === 'Invalid JSON body' && !('jsonrpc' in (health.result.json || {})), health.result.text);
    check('the sentinel is absent from the /health response and logs',
      !health.result.text.includes(SENTINEL) && !health.logs.includes(SENTINEL), health.logs);

    const info = await post(base, '/mcp-info', MALFORMED);
    check('/mcp-info is NOT the MCP path: plain body, no jsonrpc key',
      info.status === 400 && info.json?.error === 'Invalid JSON body' && !('jsonrpc' in (info.json || {})), info.text);
    const q = await post(base, '/mcp?x=1', MALFORMED);
    check('/mcp?x=1 IS the MCP path: -32700 envelope', q.status === 400 && q.json?.error?.code === -32700, q.text);
    const sub = await post(base, '/mcp/sub', MALFORMED);
    check('/mcp/sub IS the MCP path: -32700 envelope', sub.status === 400 && sub.json?.error?.code === -32700, sub.text);
    // #545: Express routes case-insensitively by default, so /MCP reaches the MCP route and
    // must get the same envelope.
    const upper = await post(base, '/MCP', MALFORMED);
    check('/MCP IS the MCP path (case-insensitive routing): -32700 envelope', upper.status === 400 && upper.json?.error?.code === -32700, upper.text);

    const big = JSON.stringify({ note: `${SENTINEL} ${'x'.repeat(4000)}` });
    const over = await captured(() => post(base, '/mcp', big));
    check('oversize body on the MCP path -> 413 with a JSON-RPC error', over.result.status === 413 && over.result.json?.jsonrpc === '2.0', over.result.text);
    check('the sentinel is absent from the 413 response and logs',
      !over.result.text.includes(SENTINEL) && !over.logs.includes(SENTINEL), over.logs);
    const overPlain = await post(base, '/health', big);
    check('oversize body elsewhere -> 413 plain', overPlain.status === 413 && overPlain.json?.error === 'Request body too large', overPlain.text);

    // Other body-parser client errors keep their exposed 4xx status (round-1 review): a 500
    // here would let any unauthenticated caller fire server-error alerts at will.
    const raw = async (path, headers, body) => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, text, json };
    };
    const cs = await captured(() => raw('/mcp', { 'content-type': 'application/json; charset=foo' }, MALFORMED));
    check('unsupported charset on the MCP path -> 415 with a -32600 envelope',
      cs.result.status === 415 && cs.result.json?.error?.code === -32600 && cs.result.json?.id === null, cs.result.text);
    check('the 415 is logged at warn, not as an unhandled error',
      cs.logs.includes('Rejected request body') && !cs.logs.includes('Unhandled request error'), cs.logs);
    const enc = await raw('/health', { 'content-encoding': 'xyz' }, MALFORMED);
    check('unsupported encoding elsewhere -> 415 plain', enc.status === 415 && enc.json?.error === 'Unsupported Media Type', enc.text);
    const gz = await captured(() => raw('/mcp', { 'content-encoding': 'gzip' }, MALFORMED));
    check('a corrupt gzip body on the MCP path -> 400 with -32600 (not a parse error)',
      gz.result.status === 400 && gz.result.json?.error?.code === -32600, gz.result.text);
    check('the sentinel is absent from the 415/400 responses and logs',
      ![cs.result.text, enc.text, gz.result.text, cs.logs, gz.logs].some((t) => t.includes(SENTINEL)), cs.logs + gz.logs);

    const ok = await post(base, '/mcp', '{"a":1}');
    check('a well-formed body is untouched by the handler (200)', ok.status === 200 && ok.json?.ok === true, ok.text);

    const boom = await captured(async () => {
      const res = await fetch(`${base}/boom`);
      return { status: res.status, text: await res.text() };
    });
    check('a thrown error -> fixed 500', boom.result.status === 500 && boom.result.text === '{"error":"Internal error"}', boom.result.text);
    check('the thrown message is absent from the response and logs',
      !boom.result.text.includes(SENTINEL) && !boom.logs.includes(SENTINEL), boom.logs);
    const unexp = await fetch(`${base}/unexposed`);
    check('a 4xx status without expose stays a fixed 500', unexp.status === 500 && (await unexp.text()) === '{"error":"Internal error"}');
    check('the 500 is logged with the error name',boom.logs.includes('Unhandled request error') && boom.logs.includes('errorName'), boom.logs);
  } finally { server.close(); }
}

console.log('\n[#543] dev mode: no stack in the response');
{
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // read once by express() at app creation
  try {
    const withH = await listen(buildApp());
    const without = await listen(buildApp({ withHandler: false }));
    try {
      const r = await fetch(`${withH.base}/boom`);
      const t = await r.text();
      check('development + handler: 500 with no message, stack frame or file path',
        r.status === 500 && !t.includes(SENTINEL) && !t.includes('    at ') && !t.includes('.js:'), t);
      const c = await captured(async () => { const res = await fetch(`${without.base}/boom`); return res.text(); });
      check('control: development WITHOUT the handler renders the stack (the exposure this closes)',
        c.result.includes(SENTINEL) || c.result.includes('    at '), c.result.slice(0, 200));
    } finally { withH.server.close(); without.server.close(); }
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }
}

console.log('\n[#543] controls: the capture can see the sentinel');
{
  const { server, base } = await listen(buildApp({ withHandler: false, echo: true }));
  try {
    const c = await captured(() => post(base, '/mcp', MALFORMED));
    check('positive control: an echoing handler puts the sentinel in the captured logs', c.logs.includes(SENTINEL), c.logs.slice(0, 200));
  } finally { server.close(); }
  const [maj, min] = expressVersion.split('.').map(Number);
  if (maj > 5 || (maj === 5 && min >= 3)) {
    const bare = await listen(buildApp({ withHandler: false }));
    try {
      const c = await captured(() => post(bare.base, '/mcp', MALFORMED));
      check(`mutation control: without the handler, express ${expressVersion}'s default logger leaks the sentinel`, c.logs.includes(SENTINEL), c.logs.slice(0, 300));
    } finally { bare.server.close(); }
  } else {
    console.log(`  skip: mutation control needs express >= 5.3.0 (installed ${expressVersion}; 5.2.x logs err.stack only)`);
  }
}

console.log('\n[#543] after headers are sent');
{
  const handler = createHttpErrorHandler({ mcpPath: '/mcp' });
  let destroyed = 0, nextCalls = 0, statusCalls = 0;
  const req = { method: 'POST', originalUrl: '/mcp', url: '/mcp', get: () => undefined, socket: { destroy: () => { destroyed++; } } };
  const res = { headersSent: true, status: () => { statusCalls++; return res; }, json: () => res };
  const c = await captured(() => handler(Object.assign(new Error(SENTINEL), { type: 'stream.aborted' }), req, res, () => { nextCalls++; }));
  check('the socket is destroyed', destroyed === 1, destroyed);
  check('next() is never called (it would reach the default logger)', nextCalls === 0, nextCalls);
  check('no second response is attempted', statusCalls === 0, statusCalls);
  check('the error message is not logged', !c.logs.includes(SENTINEL), c.logs);
  check('handler arity is 4 (Express treats it as an error handler)', handler.length === 4, handler.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
