// tests/unit/http_compressed_body_refused.test.js
//
// #633: compressed request bodies are refused with 415 before any decompression stream exists.
// GHSA-27r3-jxmh-p828: body-parser below 2.4.0 pipes a Content-Encoding body into a zlib stream
// and leaves it with no error listener, so trailing bytes after a valid frame can crash the
// process. `express.json({ inflate: false })` refuses every encoding except identity, which
// removes that path. No MCP client sends compressed request bodies.
//
// Drives the BUILT entrypoint (dist/src/index.js) over HTTP on 127.0.0.1, in the spawn style of
// startup_record_child.test.js. Deliberately unreachable upstream (127.0.0.1:5999). Every wait is
// bounded and the child is SIGKILLed at the end.
//
// Run: node tests/unit/http_compressed_body_refused.test.js   (needs `npm run build` first)

import assert from 'assert';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { createServer } from 'net';
import http from 'http';
import zlib from 'zlib';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'dist', 'src', 'index.js');
const START_MS = 10_000;
const REQUEST_MS = 10_000;
const HTTP_PATH = '/http';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[http-compressed-body-refused]');

if (!existsSync(ENTRY)) {
  console.error(`  FAIL: ${ENTRY} is missing. Run \`npm run build\` first.`);
  process.exit(1);
}

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-compressed-'));
process.on('exit', () => { try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = {
  ...process.env,
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
  ACTUAL_PASSWORD: 'test',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-4000-8000-000000000000',
  ACTUAL_DATA_DIR: DATA_DIR,
  MCP_BRIDGE_LOG_LEVEL: 'info',
  LOG_FORMAT: 'json',
};
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_SSE_AUTHORIZATION', 'MCP_STATIC_TOKENS',
  'AUTH_PROVIDER', 'MCP_ALLOW_UNAUTHENTICATED', 'MCP_BRIDGE_BIND_HOST', 'MCP_BRIDGE_STORE_LOGS', 'MCP_STDIO_MODE',
  'MCP_HTTP_PATH', 'MCP_BRIDGE_HTTP_PATH']) delete env[k];

const port = await freePort();
const proc = spawn(process.execPath, [ENTRY, '--http'], {
  env: { ...env, MCP_BRIDGE_PORT: String(port), MCP_BRIDGE_BIND_HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let exited = false;
proc.stdout.on('data', (c) => { output += c.toString(); });
proc.stderr.on('data', (c) => { output += c.toString(); });
proc.on('exit', () => { exited = true; });
process.on('exit', () => { if (!exited) proc.kill('SIGKILL'); });

const deadline = Date.now() + START_MS;
while (!output.includes('sys_startup')) {
  if (exited || Date.now() > deadline) {
    console.error(`  FAIL: the server did not start: ${output.slice(-600)}`);
    process.exit(1);
  }
  await sleep(50);
}

/** POST `body` (a Buffer) with the given headers; resolve with { status, body }. */
function post(body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: HTTP_PATH, method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'content-length': body.length,
        ...headers,
      },
      timeout: REQUEST_MS,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('timeout', () => req.destroy(new Error(`no response within ${REQUEST_MS}ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

function health() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: REQUEST_MS }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error(`no /health response within ${REQUEST_MS}ms`)));
    req.on('error', reject);
  });
}

/**
 * Our JSON-RPC error handler answered the 415 (code -32600), not the SDK. Without this, a
 * request the json parser skipped would also get a 415, from the SDK, with or without the fix.
 */
function assertOurRefusal({ status, body }) {
  assert.strictEqual(status, 415);
  assert.strictEqual(JSON.parse(body)?.error?.code, -32600, `415 body was not ours: ${body}`);
}

const initialize = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'compressed-body-test', version: '1' } },
}));

await check('gzip body: 415, and the server keeps serving', async () => {
  assertOurRefusal(await post(zlib.gzipSync(initialize), { 'content-encoding': 'gzip' }));
  assert.strictEqual(await health(), 200);
});

await check('gzip frame plus trailing bytes: 415, and /health is 200 one second later', async () => {
  assertOurRefusal(await post(Buffer.concat([zlib.gzipSync(initialize), Buffer.from('TRAILING')]), { 'content-encoding': 'gzip' }));
  await sleep(1000);
  assert.ok(!exited, `the server exited: ${output.slice(-600)}`);
  assert.strictEqual(await health(), 200);
});

await check('deflate body: 415', async () => {
  assertOurRefusal(await post(zlib.deflateSync(initialize), { 'content-encoding': 'deflate' }));
});

await check('br body: 415', async () => {
  assertOurRefusal(await post(zlib.brotliCompressSync(initialize), { 'content-encoding': 'br' }));
});

await check('an uppercase GZIP encoding: refused the same way', async () => {
  assertOurRefusal(await post(zlib.gzipSync(initialize), { 'content-encoding': 'GZIP' }));
});

await check('uncompressed body: reaches the MCP handler, which answers id 1', async () => {
  const { status, body } = await post(initialize, {});
  assert.ok(status !== 415 && status !== 400, `got ${status}`);
  assert.match(body, /"jsonrpc":"2\.0"/, `not a JSON-RPC answer: ${body.slice(0, 300)}`);
  assert.match(body, /"id":1\b/, `the answer does not carry id 1: ${body.slice(0, 300)}`);
});

await check('identity encoding: not 415', async () => {
  const { status } = await post(initialize, { 'content-encoding': 'identity' });
  assert.notStrictEqual(status, 415);
});

proc.kill('SIGKILL');
console.log(`\n[http-compressed-body-refused] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
