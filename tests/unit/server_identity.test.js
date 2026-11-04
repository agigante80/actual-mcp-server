// tests/unit/server_identity.test.js  (#624)
//
// The MCP initialize serverInfo.name used to be the description argument, so every client
// showed the server as "Bridge MCP server exposing Actual finance API to LibreChat.". This
// drives the REAL HTTP initialize in a child process (config.ts parses env once) with a
// custom description and asserts the name is the package name.
//
// connectionPool.getConnection is stubbed and _setSkipApiInitForTests(true) is set, so the
// session never logs in to a real Actual server (harness from
// multi_server_session_open_http.test.js). No token is configured, so open mode admits the
// request. The stdio leg is covered by the E2E initialize row.
//
// Imports from dist/, so `npm run build` must run first.
//
// Run: node tests/unit/server_identity.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENTINEL = '__SERVER_IDENTITY_624__ ';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const CHILD = `
const { connectionPool } = await import('./dist/src/lib/ActualConnectionPool.js');
let stubCalls = 0;
connectionPool.getConnection = async (sid) => {
  stubCalls++;
  connectionPool.connections.set(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/nonexistent', serverUrl: 'http://x:5006', password: 'pw-x', syncId: 'alpha-sync',
  });
};
const adapterMod = await import('./dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const { getMcpServerVersion, SERVER_NAME } = await import('./dist/src/lib/mcp-version.js');
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const mcp = { executeTool: async () => ({ ok: true }) };
const { listener, cleanup } = await startHttpServer(mcp, 0, '/http', {}, ['actual_accounts_list'], 'custom text', 'instr', {}, getMcpServerVersion(), '127.0.0.1', undefined);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const r = await fetch('http://127.0.0.1:' + listener.address().port + '/http', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'identity-624', version: '0' } } }),
});
const text = await r.text();
let msg;
try { msg = JSON.parse(text); }
catch { const line = text.split('\\n').find((l) => l.startsWith('data:')); msg = line ? JSON.parse(line.slice(5)) : null; }
await new Promise((res) => listener.close(res));
process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify({ status: r.status, serverInfo: msg?.result?.serverInfo ?? null, expectedVersion: getMcpServerVersion(), SERVER_NAME, stubCalls }) + '\\n');
process.exit(0);
`;

const env = {
  ...process.env,
  ACTUAL_SERVER_URL: 'http://x:5006',
  ACTUAL_PASSWORD: 'pw-x',
  ACTUAL_BUDGET_SYNC_ID: 'alpha-sync',
  AUTH_PROVIDER: 'none',
  // A token exported in the shell would turn open mode off and the initialize into a 401.
  MCP_SSE_AUTHORIZATION: undefined,
  MCP_STATIC_TOKENS: undefined,
  AUTH_BUDGET_ACL: undefined,
  MCP_ALLOW_UNAUTHENTICATED: undefined,
  USE_CONNECTION_POOL: undefined,
  NODE_ENV: 'production',
};
const dataDir = mkdtempSync(join(tmpdir(), 'server-identity-624-'));
env.MCP_BRIDGE_DATA_DIR = dataDir;
for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
rmSync(dataDir, { recursive: true, force: true });

console.log('\n[#624 server identity] initialize names the server by its package name');
let r = null;
check('the child ran to completion', () => {
  assert.strictEqual(child.signal, null, 'child hung');
  assert.strictEqual(child.status, 0, `child exited ${child.status}\n${(child.stderr || '').slice(-2000)}\n${(child.stdout || '').slice(-2000)}`);
  const lines = (child.stdout || '').split('\n').filter((l) => l.startsWith(SENTINEL));
  assert.strictEqual(lines.length, 1, 'expected one sentinel line');
  r = JSON.parse(lines[0].slice(SENTINEL.length));
});

if (r) {
  check('initialize succeeded through the stubbed connection', () => {
    assert.strictEqual(r.status, 200);
    assert.ok(r.serverInfo, 'no serverInfo in the initialize result');
    assert.ok(r.stubCalls >= 1, 'the stubbed getConnection was never called');
  });
  check('serverInfo.name is actual-mcp-server', () => {
    assert.strictEqual(r.serverInfo?.name, 'actual-mcp-server');
  });
  check('(negative) a custom description does not become the name', () => {
    assert.notStrictEqual(r.serverInfo?.name, 'custom text');
    assert.doesNotMatch(String(r.serverInfo?.name), /LibreChat/i);
  });
  check('serverInfo.version equals getMcpServerVersion()', () => {
    assert.strictEqual(r.serverInfo?.version, r.expectedVersion);
  });
  check('SERVER_NAME equals the package.json name', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(r.SERVER_NAME, pkg.name);
  });
}

check('src/index.ts no longer carries the LibreChat description sentence', () => {
  assert.ok(!readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8').includes('to LibreChat.'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
