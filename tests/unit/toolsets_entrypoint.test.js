// tests/unit/toolsets_entrypoint.test.js
//
// #483: the toolset settings, exercised through the BUILT entrypoint (dist/src/index.js), in
// the same spawn style as entrypoint_invariants.test.js. tests/unit/toolsets.test.js proves the
// policy; this proves the wiring: that the list a real client receives is the filtered one,
// that a hidden tool is refused over the wire, and that a bad setting stops the process.
//
//   stdio:  MCP_TOOLSETS=chat lists exactly the preset; tools/call of a hidden tool is refused
//           naming MCP_TOOLSETS; MCP_READ_ONLY=true lists no write-capable tool.
//   http:   the no-session tools/list path (the one path that needs no upstream Actual server)
//           returns the same filtered list. The session paths share the same `toolsList`
//           argument, which toolsets.test.js asserts by source.
//   exit 1: a typo in MCP_TOOLSETS, a typo in MCP_TOOLS, an invalid MCP_READ_ONLY value, and a
//           configuration that resolves to zero tools.
//
// Deliberately unreachable upstream: none of this may depend on a live Actual server.
//
// Run: node tests/unit/toolsets_entrypoint.test.js   (needs `npm run build` first)

import assert from 'assert';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'dist', 'src', 'index.js');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[toolsets-entrypoint]');

await check('the build these cases spawn is present', () => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing. Run \`npm run build\` first.`);
});

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-toolsets-'));
process.on('exit', () => { try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { PRESETS, WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');

const baseEnv = () => {
  const env = {
    ...process.env,
    ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
    ACTUAL_PASSWORD: 'test',
    ACTUAL_BUDGET_SYNC_ID: '00000000-0000-4000-8000-000000000000',
    ACTUAL_DATA_DIR: DATA_DIR,
    LOG_LEVEL: 'error',
  };
  for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete env[k];
  return env;
};

// The entrypoint's top-level catch passes the error MESSAGE to the logger as a bare string, which
// the formatter spreads into one `"<index>": "<char>"` line per character. Re-join those so the
// assertions read the message a human would see. (Pre-existing logging quirk, out of scope.)
function readable(stderr) {
  const chars = [...stderr.matchAll(/^\s*"(\d+)": "(.*)",?$/gm)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => m[2]);
  return `${stderr}\n${chars.join('')}`;
}

/** Spawn the entrypoint expecting it to EXIT; resolves { code, stderr }. */
function runToExit(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY, ...args], {
      env: { ...baseEnv(), ...(args.includes('--stdio') ? { MCP_STDIO_MODE: 'true' } : {}), ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`did not exit within 15s. stderr: ${stderr.slice(-400)}`)); }, 15_000);
    proc.on('error', reject);
    proc.on('exit', (code) => { clearTimeout(timer); resolve({ code, stderr: readable(stderr) }); });
  });
}

/** Speak newline-delimited JSON-RPC to a stdio server; resolves with the responses by id. */
function stdioSession(extraEnv, requests) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY, '--stdio'], {
      env: { ...baseEnv(), MCP_STDIO_MODE: 'true', ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const wanted = new Set(requests.filter((r) => r.id !== undefined).map((r) => r.id));
    const responses = new Map();
    let buf = '';
    let stderr = '';
    const finish = (err) => {
      clearTimeout(timer);
      proc.kill('SIGKILL');
      err ? reject(err) : resolve(responses);
    };
    const timer = setTimeout(() => finish(new Error(`no response to ${[...wanted].filter((i) => !responses.has(i))} in 15s. stderr: ${stderr.slice(-400)}`)), 15_000);
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', finish);
    proc.stdout.on('data', (c) => {
      buf += c.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) responses.set(msg.id, msg);
        } catch { /* non-JSON line */ }
        if ([...wanted].every((i) => responses.has(i))) return finish();
      }
    });
    for (const r of requests) proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...r }) + '\n');
  });
}

const INIT = { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'toolsets-test', version: '1' } } };
const INITIALIZED = { method: 'notifications/initialized' };
const LIST = { id: 2, method: 'tools/list' };
const sameSet = (a, b) => assert.deepStrictEqual([...a].sort(), [...b].sort());

// ---------------------------------------------------------------- stdio

await check('stdio: MCP_TOOLSETS=chat lists exactly the preset', async () => {
  const res = await stdioSession({ MCP_TOOLSETS: 'chat' }, [INIT, INITIALIZED, LIST]);
  sameSet(res.get(2).result.tools.map((t) => t.name), PRESETS.chat);
});

await check('stdio: a hidden tool is refused over the wire, naming MCP_TOOLSETS', async () => {
  const res = await stdioSession({ MCP_TOOLSETS: 'chat' }, [
    INIT, INITIALIZED,
    { id: 3, method: 'tools/call', params: { name: 'actual_bank_sync', arguments: {} } },
  ]);
  const r = res.get(3);
  const text = r.error ? r.error.message : r.result?.content?.map((c) => c.text).join(' ');
  assert.ok(r.error || r.result?.isError, `the call must fail, got ${JSON.stringify(r).slice(0, 200)}`);
  assert.ok(/MCP_TOOLSETS/.test(text), `the refusal must name MCP_TOOLSETS, got: ${text}`);
});

await check('stdio: MCP_READ_ONLY=true lists no write-capable tool, and refuses one naming MCP_READ_ONLY', async () => {
  const res = await stdioSession({ MCP_READ_ONLY: 'true' }, [
    INIT, INITIALIZED, LIST,
    { id: 3, method: 'tools/call', params: { name: 'actual_bank_sync', arguments: {} } },
  ]);
  const names = res.get(2).result.tools.map((t) => t.name);
  assert.ok(names.length > 0);
  assert.deepStrictEqual(names.filter((n) => WRITE_CAPABLE.has(n)), []);
  const r = res.get(3);
  const text = r.error ? r.error.message : r.result?.content?.map((c) => c.text).join(' ');
  assert.ok(/MCP_READ_ONLY/.test(text), `the refusal must name MCP_READ_ONLY, got: ${text}`);
});

await check('stdio: unset settings list more than the preset (the default is unchanged)', async () => {
  const res = await stdioSession({}, [INIT, INITIALIZED, LIST]);
  const names = res.get(2).result.tools.map((t) => t.name);
  assert.ok(PRESETS.chat.every((n) => names.includes(n)));
  assert.ok(names.length > PRESETS.chat.length);
});

// ---------------------------------------------------------------- startup failures

await check('a typo in MCP_TOOLSETS exits 1, naming the value', async () => {
  const { code, stderr } = await runToExit(['--stdio'], { MCP_TOOLSETS: 'transactons' });
  assert.strictEqual(code, 1);
  assert.ok(/transactons/.test(stderr), `stderr must name the value, got: ${stderr.slice(-400)}`);
});

await check('a typo in MCP_TOOLS exits 1, naming the value', async () => {
  const { code, stderr } = await runToExit(['--stdio'], { MCP_TOOLS: 'actual_accounts_lst' });
  assert.strictEqual(code, 1);
  assert.ok(/actual_accounts_lst/.test(stderr), `stderr must name the value, got: ${stderr.slice(-400)}`);
});

await check('an invalid MCP_READ_ONLY value exits 1, naming the variable and the value', async () => {
  const { code, stderr } = await runToExit(['--stdio'], { MCP_READ_ONLY: 'yes' });
  assert.strictEqual(code, 1);
  assert.ok(/MCP_READ_ONLY/.test(stderr) && /yes/.test(stderr), `stderr must name variable and value, got: ${stderr.slice(-400)}`);
});

await check('a configuration that resolves to zero tools exits 1', async () => {
  const { code, stderr } = await runToExit(['--stdio'], { MCP_TOOLSETS: 'structure', MCP_READ_ONLY: 'true' });
  assert.strictEqual(code, 1);
  assert.ok(/No tools would be published/.test(stderr), `stderr must say nothing would be published, got: ${stderr.slice(-400)}`);
});

// ---------------------------------------------------------------- http (no-session list path)

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

await check('http: the no-session tools/list path returns the filtered list', async () => {
  const port = await freePort();
  const proc = spawn(process.execPath, [ENTRY, '--http'], {
    env: { ...baseEnv(), MCP_TOOLSETS: 'chat', MCP_BRIDGE_PORT: String(port), MCP_ALLOW_UNAUTHENTICATED: 'true' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    const url = `http://127.0.0.1:${port}/http`;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    let json;
    const deadline = Date.now() + 15_000;
    while (!json) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body });
        json = await res.json();
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`the http server never answered: ${e.message}`);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    sameSet(json.result.tools.map((t) => t.name), PRESETS.chat);
  } finally {
    // SIGKILL: a detached node server ignores a polite signal while it retries its upstream.
    proc.kill('SIGKILL');
  }
});

console.log(`\n[toolsets-entrypoint] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
