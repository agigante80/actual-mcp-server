// tests/unit/config_https_validation.test.js
//
// #169: when MCP_ENABLE_HTTPS=true, both MCP_HTTPS_CERT and MCP_HTTPS_KEY must
// be set. Without the schema refine, httpServer's readFileSync(undefined!) threw
// an opaque error at startup. We test configSchema.safeParse directly so we
// exercise the validation without the module-level process.exit(1) in getConfig.
//
// Run: node tests/unit/config_https_validation.test.js

import assert from 'assert';

const { configSchema } = await import('../../dist/src/config.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Minimal valid base (the required fields). Vary only the HTTPS knobs per case.
const base = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};

console.log('\n[config-https-validation]');

check('HTTPS disabled, no cert/key: valid', () => {
  assert.strictEqual(configSchema.safeParse({ ...base }).success, true);
});

check('HTTPS disabled explicitly, no cert/key: valid', () => {
  assert.strictEqual(configSchema.safeParse({ ...base, MCP_ENABLE_HTTPS: 'false' }).success, true);
});

check('HTTPS enabled with both cert and key: valid', () => {
  const r = configSchema.safeParse({
    ...base, MCP_ENABLE_HTTPS: 'true', MCP_HTTPS_CERT: '/c.pem', MCP_HTTPS_KEY: '/k.pem',
  });
  assert.strictEqual(r.success, true);
});

check('HTTPS enabled, cert only: rejected', () => {
  const r = configSchema.safeParse({ ...base, MCP_ENABLE_HTTPS: 'true', MCP_HTTPS_CERT: '/c.pem' });
  assert.strictEqual(r.success, false);
  assert.match(JSON.stringify(r.error.issues), /MCP_HTTPS_CERT and MCP_HTTPS_KEY/);
});

check('HTTPS enabled, key only: rejected', () => {
  const r = configSchema.safeParse({ ...base, MCP_ENABLE_HTTPS: 'true', MCP_HTTPS_KEY: '/k.pem' });
  assert.strictEqual(r.success, false);
});

check('HTTPS enabled, neither set: rejected', () => {
  const r = configSchema.safeParse({ ...base, MCP_ENABLE_HTTPS: 'true' });
  assert.strictEqual(r.success, false);
});

console.log(`\n[config-https-validation] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
