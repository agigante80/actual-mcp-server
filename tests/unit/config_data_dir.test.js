// tests/unit/config_data_dir.test.js
//
// #228: MCP_BRIDGE_DATA_DIR config behaviour. The Zod schema default stays the
// non-Docker local default (./actual-data); inside the image the Dockerfile sets
// ENV MCP_BRIDGE_DATA_DIR=/app/data so a runtime override still wins. We exercise
// configSchema.safeParse directly so the assertions do not depend on process.env.
//
// Note: importing dist/src/config.js runs getConfig() at module load, which
// process.exit(1)s if the required ACTUAL_* env vars are absent (config.ts:77).
// So, like the sibling config_https_validation.test.js, this file expects the
// base ACTUAL_* env to be set (CI and the npm scripts provide them).
//
// Mirrors tests/unit/config_https_validation.test.js.
//
// Run: node tests/unit/config_data_dir.test.js

import assert from 'assert';

const { configSchema } = await import('../../dist/src/config.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const base = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};

console.log('\n[config-data-dir]');

check('default (no MCP_BRIDGE_DATA_DIR): valid, resolves to ./actual-data', () => {
  const r = configSchema.safeParse({ ...base });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_BRIDGE_DATA_DIR, './actual-data');
});

check('override is honored (the Dockerfile ENV / compose value wins)', () => {
  const r = configSchema.safeParse({ ...base, MCP_BRIDGE_DATA_DIR: '/app/data' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_BRIDGE_DATA_DIR, '/app/data');
});

check('non-string MCP_BRIDGE_DATA_DIR: rejected with an actionable message', () => {
  const r = configSchema.safeParse({ ...base, MCP_BRIDGE_DATA_DIR: 42 });
  assert.strictEqual(r.success, false);
  // Assert on the specific MCP_BRIDGE_DATA_DIR issue, not the whole issues array,
  // so a different field's invalid_type cannot satisfy this by accident.
  const issue = r.error.issues.find((i) => i.path.includes('MCP_BRIDGE_DATA_DIR'));
  assert.ok(issue, 'expected a validation issue on MCP_BRIDGE_DATA_DIR');
  assert.match(JSON.stringify(issue), /expected string|invalid_type/);
});

console.log(`\n[config-data-dir] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
