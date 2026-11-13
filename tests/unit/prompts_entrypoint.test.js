// tests/unit/prompts_entrypoint.test.js
//
// #660: the MCP prompts capability through the BUILT entrypoint (dist/src/index.js) over stdio,
// in the spawn style of toolsets_entrypoint.test.js. No live Actual server is needed: the dummy
// ACTUAL_* settings point at a closed local port. Before #660 every prompts/* request got -32601.
//
// HTTP prompts/* cannot be covered offline (a session needs a working Actual connection), so
// HTTP is proven by the wiring assertion in prompt_handlers.test.js and by the E2E row.
//
// Run: node tests/unit/prompts_entrypoint.test.js   (needs `npm run build` first)

import assert from 'assert';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
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

console.log('\n[prompts-entrypoint]');

await check('the build these cases spawn is present', () => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing. Run \`npm run build\` first.`);
});

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-prompts-'));
process.on('exit', () => { try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });


const baseEnv = () => {
  const env = {
    ...process.env,
    ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
    ACTUAL_PASSWORD: 'test',
    ACTUAL_BUDGET_SYNC_ID: '00000000-0000-4000-8000-000000000000',
    ACTUAL_DATA_DIR: DATA_DIR,
    LOG_LEVEL: 'error',
  };
  for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete env[k];
  return env;
};

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

const INIT = { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prompts-test', version: '1' } } };
const INITIALIZED = { method: 'notifications/initialized' };
const LIST = { id: 2, method: 'prompts/list' };
const GET = (name) => ({ id: 3, method: 'prompts/get', params: { name } });

const CONFIGS = [
  // #680: the default surface is compact, so the unset case offers the prompts; legacy is the explicit one.
  ['default surface', {}],
  ['MCP_TOOL_SURFACE=legacy', { MCP_TOOL_SURFACE: 'legacy' }],
  ['MCP_TOOL_SURFACE=compact', { MCP_TOOL_SURFACE: 'compact' }],
  ['MCP_TOOL_SURFACE=compact with MCP_READ_ONLY=true', { MCP_TOOL_SURFACE: 'compact', MCP_READ_ONLY: 'true' }],
];

for (const [label, env] of CONFIGS) {
  await check(`${label}: initialize advertises prompts as an object`, async () => {
    const res = await stdioSession(env, [INIT, INITIALIZED]);
    const caps = res.get(1).result.capabilities;
    assert.strictEqual(typeof caps.prompts, 'object', JSON.stringify(caps));
    assert.ok(caps.prompts !== null);
  });
  await check(`${label}: prompts/list follows the surface (legacy offers none, compact offers the read prompts)`, async () => {
    const res = await stdioSession(env, [INIT, INITIALIZED, LIST]);
    assert.ok(!res.get(2).error, JSON.stringify(res.get(2)));
    if (env.MCP_TOOL_SURFACE !== 'legacy') {
      // #661: monthly_review needs only read tools, so it is offered with or without MCP_READ_ONLY.
      assert.ok(res.get(2).result.prompts.some((p) => p.name === 'monthly_review'), JSON.stringify(res.get(2).result));
    } else {
      assert.deepStrictEqual(res.get(2).result, { prompts: [] });
    }
  });
}

await check('prompts/get of an unknown name is -32602 "Unknown prompt: no_such_prompt"', async () => {
  const res = await stdioSession({}, [INIT, INITIALIZED, GET('no_such_prompt')]);
  const err = res.get(3).error;
  assert.ok(err, JSON.stringify(res.get(3)));
  assert.strictEqual(err.code, -32602);
  assert.strictEqual(err.message, 'MCP error -32602: Unknown prompt: no_such_prompt');
});

console.log(`\n[prompts-entrypoint] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
