// tests/unit/compact_default_surface.test.js
//
// #680: MCP_TOOL_SURFACE defaults to `compact`. Everything here fails on the code before the
// flip, because that code published the 85 legacy tools when the variable was unset.
//
// What this proves, and why each part exists:
//   - the three surfaces list what they promise (15 compact, 85 legacy, both), and the default
//     is read from the REAL built entrypoint with the variable unset, not from a parameter;
//   - MCP_TOOLSETS=chat and MCP_TOOLS work in compact names (ticket decisions R1, R2): the chat
//     preset lists six tools, and each ACTION stays refused per legacy operation, naming the
//     setting that excludes it (typed `setting`, never message text alone);
//   - a legacy name is refused by default with the opt-out in the text, and a legacy name in
//     MCP_TOOLS stops startup naming the setting;
//   - MCP_READ_ONLY still wins over everything else, including MCP_TOOLS;
//   - the server instructions point the model at the compact tools, within 512 characters.
//
// Nothing here reaches the adapter: every call is refused before a legacy tool runs.
//
// Run: node tests/unit/compact_default_surface.test.js   (needs `npm run build` first)

import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'dist', 'src', 'index.js');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[compact-default-surface]');

const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const { buildServerInstructions } = await import('../../dist/src/lib/serverInstructions.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const COMPACT_NAMES = COMPACT_TOOLS.map((t) => t.name);
const COMPACT_CHAT = ['get_context', 'run_query', 'manage_transactions', 'manage_budget_months', 'manage_rules', 'list_budget_months'];
const COMPACT_READ = ['get_context', 'list_entities', 'search_transactions', 'summarize_transactions', 'list_budget_months', 'run_query'];
const UUID = '11111111-1111-4111-8111-111111111111';
const sameSet = (a, b) => assert.deepStrictEqual([...a].sort(), [...b].sort());
const reason = async (fn) => { try { await fn(); } catch (e) { return e; } return undefined; };
const init = (settings) => manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings });

// ---- the default, read from the built entrypoint with the variable unset ----

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-default-surface-'));
process.on('exit', () => { try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const spawnEnv = (extra) => {
  const env = {
    ...process.env,
    ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
    ACTUAL_PASSWORD: 'test',
    ACTUAL_BUDGET_SYNC_ID: '00000000-0000-4000-8000-000000000000',
    ACTUAL_DATA_DIR: DATA_DIR,
    LOG_LEVEL: 'error',
    MCP_STDIO_MODE: 'true',
    ...extra,
  };
  for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) if (!(k in extra)) delete env[k];
  return env;
};

function stdioList(extra) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY, '--stdio'], { env: spawnEnv(extra), stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`no tools/list answer in 15s. stderr: ${stderr.slice(-300)}`)); }, 15_000);
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.stdout.on('data', (c) => {
      buf += c.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2) { clearTimeout(timer); proc.kill('SIGKILL'); resolve(msg.result.tools.map((t) => t.name)); }
      }
    });
    const send = (m) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'default-surface-test', version: '1' } } });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
  });
}

function runToExit(extra) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY, '--stdio'], { env: spawnEnv(extra), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`did not exit within 15s. stderr: ${stderr.slice(-300)}`)); }, 15_000);
    proc.on('error', reject);
    // The entrypoint logs a failed startup message one character per line; re-join it.
    proc.on('exit', (code) => {
      clearTimeout(timer);
      const chars = [...stderr.matchAll(/^\s*"(\d+)": "(.*)",?$/gm)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]);
      resolve({ code, stderr: `${stderr}\n${chars.join('')}` });
    });
  });
}

await check('the built entrypoint with MCP_TOOL_SURFACE unset lists exactly the 15 compact tools, none prefixed actual_', async () => {
  const names = await stdioList({});
  assert.deepStrictEqual(names, COMPACT_NAMES);
  assert.strictEqual(names.length, 15);
  assert.ok(names.every((n) => !n.startsWith('actual_')));
});

await check('NEGATIVE: MCP_TOOL_SURFACE=legacy on the built entrypoint lists 85 actual_ tools and no compact one', async () => {
  const names = await stdioList({ MCP_TOOL_SURFACE: 'legacy' });
  assert.strictEqual(names.length, 85);
  assert.ok(names.every((n) => n.startsWith('actual_')));
  assert.ok(!names.includes('get_context'));
});

await check('a legacy name in MCP_TOOLS exits 1 under the default surface, naming the tool and MCP_TOOL_SURFACE', async () => {
  const { code, stderr } = await runToExit({ MCP_TOOLS: 'actual_accounts_list' });
  assert.strictEqual(code, 1);
  assert.ok(/actual_accounts_list/.test(stderr), `must name the tool, got: ${stderr.slice(-400)}`);
  assert.ok(/MCP_TOOL_SURFACE/.test(stderr), `must name MCP_TOOL_SURFACE, got: ${stderr.slice(-400)}`);
});

await check('NEGATIVE: the same MCP_TOOLS value starts fine on the legacy surface', async () => {
  const names = await stdioList({ MCP_TOOL_SURFACE: 'legacy', MCP_TOOLS: 'actual_accounts_list' });
  assert.ok(names.includes('actual_accounts_list'));
});

// ---- the three surfaces, in process ----

await check('the config schema default for MCP_TOOL_SURFACE is compact', async () => {
  const { configSchema } = await import('../../dist/src/config.js');
  const r = configSchema.safeParse({ ACTUAL_SERVER_URL: 'http://127.0.0.1:5999', ACTUAL_PASSWORD: 'x', ACTUAL_BUDGET_SYNC_ID: UUID });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_TOOL_SURFACE, 'compact');
});

await check('compact lists the 15 compact tools, legacy lists 85, all lists both (100)', async () => {
  await init({ surface: 'compact' });
  assert.deepStrictEqual(manager.getPublishedToolNames(), COMPACT_NAMES);
  await init({ surface: 'legacy' });
  const legacy = manager.getPublishedToolNames();
  assert.strictEqual(legacy.length, 85);
  assert.ok(legacy.every((n) => n.startsWith('actual_')));
  await init({ surface: 'all' });
  const all = manager.getPublishedToolNames();
  assert.strictEqual(all.length, 100);
  sameSet(all, [...legacy, ...COMPACT_NAMES]);
});

// ---- the chat preset, in compact names (R1) ----

await check('MCP_TOOLSETS=chat under compact lists exactly the six compact chat tools', async () => {
  await init({ surface: 'compact', toolsets: 'chat' });
  sameSet(manager.getPublishedToolNames(), COMPACT_CHAT);
});

await check('NEGATIVE: the chat list does not carry the tools whose every action is outside the preset', async () => {
  await init({ surface: 'compact', toolsets: 'chat' });
  const names = manager.getPublishedToolNames();
  for (const n of ['manage_accounts', 'manage_categories', 'manage_payees', 'manage_tags', 'manage_schedules', 'manage_budget_files', 'list_entities']) {
    assert.ok(!names.includes(n), `${n} must not be listed under chat`);
  }
});

await check('chat: manage_transactions action import is refused naming MCP_TOOLSETS, with no legacy name in the text', async () => {
  await init({ surface: 'compact', toolsets: 'chat' });
  const e = await reason(() => manager.callTool('manage_transactions', { action: 'import', account_id: UUID, txs: [{ date: '2024-01-15', amount: 5000 }] }));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_TOOLSETS');
  assert.ok(!/actual_/.test(e.message), e.message);
});

await check('chat: manage_rules action delete is refused naming MCP_TOOLSETS', async () => {
  await init({ surface: 'compact', toolsets: 'chat' });
  const e = await reason(() => manager.callTool('manage_rules', { action: 'delete', id: UUID }));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_TOOLSETS');
});

await check('a toolset without admin: manage_accounts is listed and its bank_sync action is refused naming MCP_TOOLSETS', async () => {
  await init({ surface: 'compact', toolsets: 'structure' });
  assert.ok(manager.getPublishedToolNames().includes('manage_accounts'));
  const e = await reason(() => manager.callTool('manage_accounts', { action: 'bank_sync' }));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_TOOLSETS');
  assert.ok(!/actual_/.test(e.message), e.message);
});

// ---- MCP_TOOLS in compact names (R2) ----

await check('MCP_TOOLS=list_entities under a narrowed toolset adds the compact tool, and its actions work', async () => {
  await init({ surface: 'compact', toolsets: 'query', tools: 'list_entities' });
  sameSet(manager.getPublishedToolNames(), ['run_query', 'list_entities']);
});

await check('NEGATIVE: a legacy name or an unknown name in MCP_TOOLS under compact throws, naming the setting for a legacy name', async () => {
  const legacy = await reason(() => init({ surface: 'compact', tools: 'actual_accounts_list' }));
  assert.ok(legacy && /actual_accounts_list/.test(legacy.message) && /MCP_TOOL_SURFACE/.test(legacy.message), String(legacy));
  const typo = await reason(() => init({ surface: 'compact', tools: 'list_entitiez' }));
  assert.ok(typo && /list_entitiez/.test(typo.message), String(typo));
});

// ---- a legacy name is refused by default ----

await check('under the default surface a legacy name is refused with setting MCP_TOOL_SURFACE, naming the opt-out', async () => {
  await init({ surface: 'compact' });
  const e = await reason(() => manager.callTool('actual_accounts_list', {}));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_TOOL_SURFACE');
  assert.ok(e.message.includes('MCP_TOOL_SURFACE=legacy'), e.message);
});

await check('a legacy name outside a narrowed MCP_TOOLSETS is still refused naming the surface, not MCP_TOOLSETS', async () => {
  await init({ surface: 'compact', toolsets: 'chat' });
  const e = await reason(() => manager.callTool('actual_accounts_list', {}));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_TOOL_SURFACE');
  assert.ok(e.message.includes('MCP_TOOL_SURFACE=legacy'), e.message);
});

await check('NEGATIVE: a compact name in MCP_TOOLS under legacy stops startup naming MCP_TOOL_SURFACE=compact', async () => {
  const e = await reason(() => init({ surface: 'legacy', tools: 'get_context' }));
  assert.ok(e && /get_context/.test(e.message) && e.message.includes('MCP_TOOL_SURFACE=compact'), String(e));
});

await check('NEGATIVE: a compact name is refused under the legacy surface, naming MCP_TOOL_SURFACE=compact', async () => {
  await init({ surface: 'legacy' });
  const e = await reason(() => manager.callTool('get_context', {}));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_TOOL_SURFACE');
  assert.ok(e.message.includes('MCP_TOOL_SURFACE=compact'), e.message);
});

// ---- read-only ----

await check('MCP_READ_ONLY=true under the default surface lists exactly the six read tools', async () => {
  await init({ surface: 'compact', readOnly: true });
  assert.deepStrictEqual(manager.getPublishedToolNames(), COMPACT_READ);
});

await check('read-only: manage_transactions is refused naming MCP_READ_ONLY', async () => {
  await init({ surface: 'compact', readOnly: true });
  const e = await reason(() => manager.callTool('manage_transactions', { action: 'delete', id: UUID }));
  assert.ok(e instanceof ToolUnavailableError, String(e));
  assert.strictEqual(e.setting, 'MCP_READ_ONLY');
});

await check('read-only beats MCP_TOOLS: a writer named there stays unpublished and refused for MCP_READ_ONLY', async () => {
  await init({ surface: 'compact', readOnly: true, tools: 'manage_transactions' });
  assert.deepStrictEqual(manager.getPublishedToolNames(), COMPACT_READ);
  const e = await reason(() => manager.callTool('manage_transactions', { action: 'delete', id: UUID }));
  assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', String(e));
});

// ---- server instructions ----

await check('instructions on the default surface name get_context and run_query, no actual_ name, within 512 characters', async () => {
  await init({ surface: 'compact' });
  const text = buildServerInstructions(manager.getPublishedToolNames(), false);
  assert.ok(text.includes('get_context') && text.includes('run_query'), text);
  assert.ok(!/actual_/.test(text), text);
  assert.ok(text.length <= 512, `${text.length} characters`);
});

await check('NEGATIVE: instructions never name a compact tool that is not published, and name legacy ones on the legacy surface', async () => {
  await init({ surface: 'compact', toolsets: 'structure' });
  const narrowed = buildServerInstructions(manager.getPublishedToolNames(), false);
  assert.ok(!narrowed.includes('get_context') && !narrowed.includes('run_query'), narrowed);
  await init({ surface: 'legacy' });
  const legacy = buildServerInstructions(manager.getPublishedToolNames(), false);
  assert.ok(legacy.includes('actual_get_context') && !legacy.includes(' get_context ') , legacy);
});

await init({ surface: 'compact' });
console.log(`\n[compact-default-surface] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
