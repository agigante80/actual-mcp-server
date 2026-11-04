// tests/unit/startup_record_child.test.js
//
// #623: the sys_startup record through the BUILT entrypoint (dist/src/index.js), in the spawn
// style of toolsets_entrypoint.test.js. startup_record.test.js proves the builder; this proves
// the wiring: the record is logged once the server has really started, and never otherwise.
//
//   stdio:  the record arrives on stderr at level info, and stdout carries nothing before the
//           first JSON-RPC frame (stdout is the protocol channel).
//   http:   bound to 127.0.0.1 on a free port, the record arrives with the listener's real port.
//           (Outside stdio the logger writes to stdout, so the HTTP cases read both streams.)
//   no record when the start fails: the port is already taken (the process exits non-zero or
//           logs sys_crash first), or a weak token on a non-loopback bind refuses to start.
//
// Deliberately unreachable upstream: none of this may depend on a live Actual server. Every wait
// is bounded at 10s and every child is killed with SIGKILL.
//
// Run: node tests/unit/startup_record_child.test.js   (needs `npm run build` first)

import assert from 'assert';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'dist', 'src', 'index.js');
const WAIT_MS = 10_000;
// After the first record the child keeps running this long, so a second (duplicate) record
// would be captured and fail the exactly-one assertion (#623 review round 1).
const SETTLE_MS = 1_500;

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[startup-record-child]');

await check('the build these cases spawn is present', () => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing. Run \`npm run build\` first.`);
});

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-startup-record-'));
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
    'AUTH_PROVIDER', 'MCP_ALLOW_UNAUTHENTICATED', 'MCP_BRIDGE_BIND_HOST', 'MCP_BRIDGE_STORE_LOGS']) delete env[k];
  return env;
};

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

/** The parsed sys_startup JSON lines in a stderr capture. */
function startupRecords(stderr) {
  const out = [];
  for (const line of stderr.split('\n')) {
    if (!line.includes('sys_startup')) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.message === 'sys_startup') out.push(msg);
    } catch { /* not a JSON line */ }
  }
  return out;
}

/**
 * Spawn the entrypoint and wait until `done(state)` is true (then SETTLE_MS more when `settle`),
 * the process exits, or WAIT_MS passes. Always SIGKILLs the child.
 * Resolves { stdout, stderr, code, exited, timedOut }.
 */
function run(args, extraEnv, done, settle = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY, ...args], {
      env: { ...baseEnv(), ...(args.includes('--stdio') ? { MCP_STDIO_MODE: 'true' } : {}), ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const state = { stdout: '', stderr: '', code: null, exited: false, timedOut: false };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill('SIGKILL');
      resolve(state);
    };
    const timer = setTimeout(() => { state.timedOut = true; finish(); }, WAIT_MS);
    let settling = false;
    const poll = () => {
      if (settling || !done(state)) return;
      if (!settle) { finish(); return; }
      settling = true;
      setTimeout(finish, SETTLE_MS);
    };
    proc.stdout.on('data', (c) => { state.stdout += c.toString(); poll(); });
    proc.stderr.on('data', (c) => { state.stderr += c.toString(); poll(); });
    proc.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    proc.on('exit', (code) => { state.code = code; state.exited = true; finish(); });
    if (args.includes('--stdio')) {
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'startup-record-test', version: '1' },
      } }) + '\n');
    }
  });
}

// ---------------------------------------------------------------- stdio

await check('stdio: the record is on stderr at info, stdout is clean before the first frame', async () => {
  const s = await run(['--stdio'], {}, (st) => startupRecords(st.stderr).length > 0 && st.stdout.includes('\n'), true);
  const recs = startupRecords(s.stderr);
  assert.strictEqual(recs.length, 1, `expected one sys_startup record, got ${recs.length}. stderr: ${s.stderr.slice(-600)}`);
  assert.strictEqual(recs[0].level, 'info');
  assert.strictEqual(recs[0].context.event, 'sys_startup');
  assert.deepStrictEqual(recs[0].context.transport, { kind: 'stdio' });
  assert.strictEqual(recs[0].context.auth.posture, 'n/a');
  const first = s.stdout.split('\n')[0];
  const frame = JSON.parse(first);
  assert.strictEqual(frame.jsonrpc, '2.0', `stdout began with something other than a JSON-RPC frame: ${first.slice(0, 200)}`);
  assert.ok(!s.stdout.includes('sys_startup'), 'the record leaked onto stdout');
});

// ---------------------------------------------------------------- http

await check('http on 127.0.0.1: the record carries the real port, loopback scope and posture', async () => {
  const port = await freePort();
  const s = await run(['--http'], { MCP_BRIDGE_PORT: String(port), MCP_BRIDGE_BIND_HOST: '127.0.0.1' },
    (st) => startupRecords(st.stdout + st.stderr).length > 0, true);
  const recs = startupRecords(s.stdout + s.stderr);
  assert.strictEqual(recs.length, 1, `expected one sys_startup record, got ${recs.length}. output: ${(s.stdout + s.stderr).slice(-600)}`);
  const t = recs[0].context.transport;
  assert.strictEqual(t.kind, 'http');
  assert.strictEqual(t.port, port);
  assert.strictEqual(t.bindScope, 'loopback');
  assert.strictEqual(recs[0].context.auth.posture, 'serve');
  assert.strictEqual(typeof recs[0].context.limits.keepAliveMs, 'number');
});

// ---------------------------------------------------------------- failed starts

await check('http on a taken port: the start fails and no record is logged', async () => {
  const blocker = createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const { port } = blocker.address();
  try {
    const s = await run(['--http'], { MCP_BRIDGE_PORT: String(port), MCP_BRIDGE_BIND_HOST: '127.0.0.1' },
      (st) => st.stderr.includes('sys_crash'));
    // The failure must be observed before "no record" means anything. Before the #623 rethrow
    // in httpServer.ts the process logged "listening" and the record, then exited 0.
    assert.ok((s.exited && s.code !== 0) || s.stderr.includes('sys_crash'),
      `no failure observed within ${WAIT_MS}ms (exited=${s.exited} code=${s.code}). stderr: ${s.stderr.slice(-600)}`);
    assert.strictEqual(startupRecords(s.stdout + s.stderr).length, 0, 'a sys_startup record was logged for a failed start');
  } finally {
    await new Promise((r) => blocker.close(r));
  }
});

await check('weak token on 0.0.0.0: exit 1 with the refusal, and no record', async () => {
  const port = await freePort();
  const s = await run(['--http'], { MCP_BRIDGE_PORT: String(port), MCP_BRIDGE_BIND_HOST: '0.0.0.0', MCP_SSE_AUTHORIZATION: 'short' },
    () => false);
  assert.ok(s.exited, `did not exit within ${WAIT_MS}ms. stderr: ${s.stderr.slice(-600)}`);
  assert.strictEqual(s.code, 1);
  const output = s.stdout + s.stderr;
  assert.ok(output.includes('Refusing to start: weak token on a non-loopback bind'), `refusal text missing. output: ${output.slice(-600)}`);
  assert.strictEqual(startupRecords(output).length, 0, 'a sys_startup record was logged for a refused start');
});

console.log(`\n[startup-record-child] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
