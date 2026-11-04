// tests/unit/http_sigterm_exit_child.test.js
//
// #632: the HTTP server exits on SIGTERM and SIGINT. Before the fix the signal handler ran the
// session cleanup and returned, the listener stayed open, and the process lived until Docker's
// SIGKILL 10 seconds later. These cases drive the BUILT entrypoint (dist/src/index.js) with real
// signals, in the spawn style of startup_record_child.test.js:
//
//   SIGTERM / SIGINT:  exit code 0 within EXIT_MS, after the cleanup log line.
//   keep-alive:        an idle keep-alive socket held by the client does not block the exit.
//   open connection:   an ACTIVE connection (a request whose headers never finish) does not block
//                      the exit either, which closeIdleConnections() alone would not end.
//   second signal:     two SIGTERMs back to back never hang; an exit 1 names the second signal.
//   no signal:         the server is still alive after NO_SIGNAL_MS (guards an exit wired to the
//                      wrong event).
//
// Deliberately unreachable upstream (127.0.0.1:5999): nothing here depends on a live Actual
// server. Every wait is bounded and every child is SIGKILLed when its case ends.
//
// Run: node tests/unit/http_sigterm_exit_child.test.js   (needs `npm run build` first)

import assert from 'assert';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { createServer, connect } from 'net';
import http from 'http';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'dist', 'src', 'index.js');
const START_MS = 10_000;
const EXIT_MS = 5_000;
const NO_SIGNAL_MS = 2_000;

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[http-sigterm-exit-child]');

await check('the build these cases spawn is present', () => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing. Run \`npm run build\` first.`);
});

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-sigterm-'));
process.on('exit', () => { try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const baseEnv = () => {
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
    'AUTH_PROVIDER', 'MCP_ALLOW_UNAUTHENTICATED', 'MCP_BRIDGE_BIND_HOST', 'MCP_BRIDGE_STORE_LOGS', 'MCP_STDIO_MODE']) delete env[k];
  return env;
};

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the HTTP server on 127.0.0.1 and resolve once its sys_startup record is logged.
 * Returns { proc, port, state, exited } where `exited` resolves with the exit code.
 */
async function startServer() {
  const port = await freePort();
  const proc = spawn(process.execPath, [ENTRY, '--http'], {
    env: { ...baseEnv(), MCP_BRIDGE_PORT: String(port), MCP_BRIDGE_BIND_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { output: '', code: null, exited: false };
  proc.stdout.on('data', (c) => { state.output += c.toString(); });
  proc.stderr.on('data', (c) => { state.output += c.toString(); });
  const exited = new Promise((resolve) => {
    proc.on('exit', (code) => { state.code = code; state.exited = true; resolve(code); });
  });
  const deadline = Date.now() + START_MS;
  while (!state.output.includes('sys_startup')) {
    if (state.exited) throw new Error(`server exited before starting (code ${state.code}): ${state.output.slice(-600)}`);
    if (Date.now() > deadline) { proc.kill('SIGKILL'); throw new Error(`no sys_startup within ${START_MS}ms: ${state.output.slice(-600)}`); }
    await sleep(50);
  }
  return { proc, port, state, exited };
}

/** Resolve with the exit code, or with the string 'timeout' after `ms`. */
function exitWithin(server, ms) {
  return Promise.race([server.exited, sleep(ms).then(() => 'timeout')]);
}

function kill(server) {
  if (!server.state.exited) server.proc.kill('SIGKILL');
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  await check(`${signal}: exit code 0 within ${EXIT_MS}ms, after the session cleanup`, async () => {
    const s = await startServer();
    try {
      s.proc.kill(signal);
      const code = await exitWithin(s, EXIT_MS);
      assert.strictEqual(code, 0, `expected exit 0 after ${signal}, got ${code}. output: ${s.state.output.slice(-600)}`);
      assert.ok(s.state.output.includes('[SERVER] Shutting down'), `the cleanup log line is missing. output: ${s.state.output.slice(-600)}`);
    } finally { kill(s); }
  });
}

await check('an idle keep-alive connection does not block the exit', async () => {
  const s = await startServer();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: s.port, path: '/health', agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
    });
    // The socket is now idle in the agent's free pool, held open by keep-alive.
    assert.ok(Object.keys(agent.freeSockets).length > 0, 'the agent holds no idle socket, so this case proves nothing');
    s.proc.kill('SIGTERM');
    const code = await exitWithin(s, EXIT_MS);
    assert.strictEqual(code, 0, `expected exit 0 with an idle keep-alive socket, got ${code}. output: ${s.state.output.slice(-600)}`);
  } finally { agent.destroy(); kill(s); }
});

await check('an open connection with an unfinished request does not block the exit', async () => {
  const s = await startServer();
  const sock = connect(s.port, '127.0.0.1');
  sock.on('error', () => {});
  try {
    await new Promise((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    // Headers never end, so the server holds this connection open and it is never idle.
    sock.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\n`);
    await sleep(200);
    assert.ok(!sock.destroyed, 'the server closed the connection before the signal, so this case proves nothing');
    const t0 = Date.now();
    s.proc.kill('SIGTERM');
    const code = await exitWithin(s, EXIT_MS);
    assert.strictEqual(code, 0, `expected exit 0 with an open connection, got ${code}. output: ${s.state.output.slice(-600)}`);
    assert.ok(Date.now() - t0 < 8000, 'the exit waited for the shutdown deadline');
  } finally { sock.destroy(); kill(s); }
});

await check('a second SIGTERM during shutdown never hangs, and an exit 1 names it', async () => {
  const s = await startServer();
  try {
    s.proc.kill('SIGTERM');
    s.proc.kill('SIGTERM');
    const code = await exitWithin(s, EXIT_MS);
    assert.ok(code === 0 || code === 1, `expected exit 0 or 1, got ${code}. output: ${s.state.output.slice(-600)}`);
    if (code === 1) {
      assert.ok(s.state.output.includes('Second SIGTERM during shutdown'), `exit 1 without the second-signal log line. output: ${s.state.output.slice(-600)}`);
    }
  } finally { kill(s); }
});

await check(`no signal: the server is still running after ${NO_SIGNAL_MS}ms`, async () => {
  const s = await startServer();
  try {
    const code = await exitWithin(s, NO_SIGNAL_MS);
    assert.strictEqual(code, 'timeout', `the server exited on its own with code ${code}. output: ${s.state.output.slice(-600)}`);
  } finally { kill(s); }
});

console.log(`\n[http-sigterm-exit-child] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
