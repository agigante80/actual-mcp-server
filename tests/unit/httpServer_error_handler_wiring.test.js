// tests/unit/httpServer_error_handler_wiring.test.js
//
// #543: the error handler is WIRED into the real HTTP server (startHttpServer from dist), as
// its last layer, and only there. Behavioural, over real HTTP on loopback in the default
// AUTH_PROVIDER=none mode, with a NON-ROOT MCP path ('/http', the MCP_HTTP_PATH default) so
// the MCP and non-MCP shapes are actually separated:
//   - malformed JSON carrying a sentinel to the MCP path -> 400 + JSON-RPC -32700;
//   - the same to /health -> 400 + plain {error};
//   - the sentinel never appears in a response or in anything logged (console.error included);
//   - GET /metrics keeps its pre-bump Content-Type (captured on express 5.2.1);
//   - the last router layer is a 4-arity handler, and the stdio transport does not import it.
//
// Run: node tests/unit/httpServer_error_handler_wiring.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

if (process.env.NODE_ENV === 'test') delete process.env.NODE_ENV;
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';
delete process.env.AUTH_PROVIDER;
delete process.env.MCP_SSE_AUTHORIZATION;

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { process.stderr.write(`  ok: ${label}\n`); passed++; }
  else { process.stderr.write(`  FAIL: ${label}${detail ? ` (${String(detail).slice(0, 400)})` : ''}\n`); failed++; }
}

const SENTINEL = 'SENTINEL-543';
const MALFORMED = `{"jsonrpc":"2.0","method":"tools/call","params":{"note":"${SENTINEL} Bearer eyJfake"`;
// Captured on the pre-bump commit c85c69d4 (express 5.2.1): res.send adds the charset
// BEFORE the version parameter. The ticket's predicted order was wrong; this is the real value.
const METRICS_CONTENT_TYPE = 'text/plain; charset=utf-8; version=0.0.4';
const here = dirname(fileURLToPath(import.meta.url));

const { startHttpServer } = await import('../../dist/src/server/httpServer.js');

// Capture everything logged from here on (the logger routes console.* into winston).
const logged = [];
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
const origConsoleError = console.error;
process.stdout.write = (c, ...a) => { logged.push(String(c)); return origOut(c, ...a); };
process.stderr.write = (c, ...a) => { if (!String(c).startsWith('  ok: ') && !String(c).startsWith('  FAIL: ')) logged.push(String(c)); return origErr(c, ...a); };
console.error = (...args) => { logged.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')); origConsoleError(...args); };

console.log('\n[#543] error handler wiring in the real HTTP server');
const { app, listener, cleanup } = await startHttpServer(
  {}, 0, '/http', {}, ['actual_accounts_list'], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined,
);
try {
  if (!listener.listening) {
    await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
  }
  const base = `http://127.0.0.1:${listener.address().port}`;
  const post = async (path) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: MALFORMED });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };

  const mcp = await post('/http');
  check('malformed POST to the MCP path (/http) -> 400', mcp.status === 400, `${mcp.status} ${mcp.text}`);
  check('-> JSON-RPC -32700 with id null', mcp.json?.jsonrpc === '2.0' && mcp.json?.error?.code === -32700 && mcp.json?.id === null, mcp.text);
  check('the sentinel is absent from the MCP response', !mcp.text.includes(SENTINEL), mcp.text);

  const health = await post('/health');
  check('malformed POST to /health -> 400 plain, no jsonrpc key',
    health.status === 400 && health.json?.error === 'Invalid JSON body' && !('jsonrpc' in (health.json || {})), `${health.status} ${health.text}`);
  check('the sentinel is absent from the /health response', !health.text.includes(SENTINEL), health.text);

  const metrics = await fetch(`${base}/metrics`);
  await metrics.text();
  check(`GET /metrics -> 200 (a 204 means no metrics text and is a failure; got ${metrics.status})`, metrics.status === 200);
  check(`GET /metrics Content-Type is unchanged (${METRICS_CONTENT_TYPE})`,
    metrics.headers.get('content-type') === METRICS_CONTENT_TYPE, metrics.headers.get('content-type'));

  await new Promise((r) => setTimeout(r, 50));
  const logs = logged.join('');
  check('the sentinel is absent from everything logged', !logs.includes(SENTINEL), logs.slice(logs.indexOf(SENTINEL) - 200, logs.indexOf(SENTINEL) + 100));
  check('the rejections were logged (the capture is live)', logs.includes('entity.parse.failed'), logs.slice(-300));

  const last = app.router.stack.at(-1);
  check('the last router layer is a 4-arity error handler', last?.handle?.length === 4, last?.handle?.length);
  check('the last router layer is the #543 handler', last?.handle?.name === 'httpErrorHandler', last?.handle?.name);
} finally {
  process.stdout.write = origOut;
  process.stderr.write = origErr;
  console.error = origConsoleError;
  await new Promise((res) => listener.close(res));
  await cleanup().catch(() => {});
}

const stdioSrc = readFileSync(resolve(here, '../../src/server/stdioServer.ts'), 'utf8');
check('src/server/stdioServer.ts does not import httpErrorHandler', !stdioSrc.includes('httpErrorHandler'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
