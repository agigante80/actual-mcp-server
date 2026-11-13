// tests/unit/tdqs_capture_env.test.js
//
// #679: the TDQS harness capture builds a closed child env. The surface, toolset, tool list and
// read-only keys are always set, so a developer .env (dotenv never overrides a present key) cannot
// leak into the capture; an unknown surface is refused before anything is spawned or written.
//
// Run: node tests/unit/tdqs_capture_env.test.js

import assert from 'assert';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[tdqs-capture-env]');

const SCRIPT = new URL('../../scripts/tdqs/tdqs.mjs', import.meta.url).pathname;
// Importing must not run the CLI (the main guard); a failed guard would exit 2 here.
const { captureEnv } = await import('../../scripts/tdqs/tdqs.mjs');

await check('importing the module runs no CLI command', () => {
  assert.strictEqual(typeof captureEnv, 'function');
});

await check('compact: surface, toolsets, tools, read-only, data dir and dummy URL', () => {
  const e = captureEnv('compact', '/x');
  assert.strictEqual(e.MCP_TOOL_SURFACE, 'compact');
  assert.strictEqual(e.MCP_TOOLSETS, 'all');
  assert.strictEqual(e.MCP_TOOLS, '');
  assert.strictEqual(e.MCP_READ_ONLY, 'false');
  assert.strictEqual(e.MCP_BRIDGE_DATA_DIR, '/x');
  assert.strictEqual(e.ACTUAL_SERVER_URL, 'http://127.0.0.1:5999');
});

await check('legacy: surface is set (not absent) and the same pinned keys', () => {
  const e = captureEnv('legacy', '/x');
  assert.ok(Object.hasOwn(e, 'MCP_TOOL_SURFACE'));
  assert.strictEqual(e.MCP_TOOL_SURFACE, 'legacy');
  assert.strictEqual(e.MCP_TOOLSETS, 'all');
  assert.strictEqual(e.MCP_TOOLS, '');
  assert.strictEqual(e.MCP_READ_ONLY, 'false');
});

for (const [label, v] of [['bogus', 'bogus'], ['all', 'all'], ['undefined (bare --surface)', undefined]]) {
  await check(`NEGATIVE: surface ${label} throws naming legacy and compact`, () => {
    assert.throws(() => captureEnv(v, '/x'), (err) => /legacy/.test(err.message) && /compact/.test(err.message));
  });
}

await check('NEGATIVE: capture --surface bogus exits 2 with usage and writes no file', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'tdqs-test-')), 'out.json');
  const r = spawnSync(process.execPath, [SCRIPT, 'capture', '.', out, '--surface', 'bogus'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.ok(/usage: capture/.test(r.stderr), r.stderr);
  assert.ok(!existsSync(out));
});

console.log(`\n[tdqs-capture-env] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
