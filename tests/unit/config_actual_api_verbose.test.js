// tests/unit/config_actual_api_verbose.test.js
//
// #620: ACTUAL_API_VERBOSE turns upstream @actual-app/api's verbose logging back on. Off by
// default, and only the exact string `true` enables it: turning it on writes transaction
// contents into the log, so every other value fails safe. Config is parsed once per process,
// so the matrix runs as configSchema.safeParse rows (the config_insecure_upstream precedent).
//
// Run: node tests/unit/config_actual_api_verbose.test.js

import assert from 'assert';

const { configSchema } = await import('../../dist/src/config.js');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const base = { ACTUAL_SERVER_URL: 'http://actual:5006', ACTUAL_PASSWORD: 'pw', ACTUAL_BUDGET_SYNC_ID: 'sync-1' };
const parsed = (extra) => {
  const r = configSchema.safeParse({ ...base, ...extra });
  assert.strictEqual(r.success, true, JSON.stringify(r.error?.issues));
  return r.data.ACTUAL_API_VERBOSE;
};

console.log('\n[#620] ACTUAL_API_VERBOSE parse matrix');

check('unset: false', () => assert.strictEqual(parsed({}), false));
check('"true": true', () => assert.strictEqual(parsed({ ACTUAL_API_VERBOSE: 'true' }), true));
for (const v of ['1', 'yes', 'false', 'TRUE', 'TRUE ', ' true', '']) {
  check(`${JSON.stringify(v)}: false`, () => assert.strictEqual(parsed({ ACTUAL_API_VERBOSE: v }), false));
}

console.log(`\n[config-actual-api-verbose] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
