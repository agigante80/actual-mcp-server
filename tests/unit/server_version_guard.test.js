// tests/unit/server_version_guard.test.js
//
// #276: the Actual Budget server-version compatibility warning. Covers the pure comparator
// truth table, fail-open on unparseable input, the once-guard, and that the warning path
// emits ONLY through the passed logger (never console.*), so stdio JSON-RPC framing on
// stdout is never corrupted. Mirrors tests/unit/node_version_guard.test.js.
//
// Run: node tests/unit/server_version_guard.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const {
  parseVersion, checkServerVersion, checkServerVersionOnce, _resetForTests,
} = await import('../../dist/src/lib/server-version-guard.js');
const { SUPPORTED_ACTUAL_SERVER_RANGE } = await import('../../dist/src/lib/constants.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
async function checkAsync(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[server-version-guard]');

// The default range in constants.ts: min 25.0.0, tested up to major 26.
const RANGE = SUPPORTED_ACTUAL_SERVER_RANGE;

check('parseVersion handles bare and v-prefixed, missing patch', () => {
  assert.deepStrictEqual(parseVersion('26.7.0'), [26, 7, 0]);
  assert.deepStrictEqual(parseVersion('v25.5.0'), [25, 5, 0]);
  assert.deepStrictEqual(parseVersion('26.7'), [26, 7, 0]);
});

check('parseVersion returns null on garbage', () => {
  assert.strictEqual(parseVersion('not-a-version'), null);
  assert.strictEqual(parseVersion(''), null);
  assert.strictEqual(parseVersion(undefined), null);
});

check('TRUTH TABLE: a version inside the range is ok with no message', () => {
  const v = checkServerVersion('25.5.0', RANGE);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.message, undefined);
});

check('TRUTH TABLE: the low and high in-range boundaries are ok', () => {
  assert.strictEqual(checkServerVersion('25.0.0', RANGE).ok, true);  // exactly min
  assert.strictEqual(checkServerVersion('26.99.99', RANGE).ok, true); // top of tested major
});

check('TRUTH TABLE: just below the floor is not ok, message names version and range', () => {
  const v = checkServerVersion('24.9.0', RANGE);
  assert.strictEqual(v.ok, false);
  assert.ok(v.message.includes('24.9.0'), 'must name the running version');
  assert.ok(v.message.includes(RANGE.minVersion), 'must name the minimum');
  assert.ok(/older/i.test(v.message));
});

check('TRUTH TABLE: above the tested major is not ok, worded "newer than tested"', () => {
  const v = checkServerVersion('27.0.0', RANGE);
  assert.strictEqual(v.ok, false);
  assert.ok(v.message.includes('27.0.0'));
  assert.ok(/newer/i.test(v.message));
});

check('FAILS OPEN: an unparseable running version produces no warning', () => {
  assert.strictEqual(checkServerVersion('not-a-version', RANGE).ok, true);
  assert.strictEqual(checkServerVersion('', RANGE).ok, true);
  assert.strictEqual(checkServerVersion(undefined, RANGE).ok, true);
});

// --- the once-guard + logger-only emission ----------------------------------

function spyLogger() {
  const calls = { warn: [], debug: [] };
  return {
    logger: { warn: (m) => calls.warn.push(m), debug: (m) => calls.debug.push(m) },
    calls,
  };
}

await checkAsync('ONCE: an out-of-range version warns exactly once, even across many ops', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  const read = async () => ({ version: '24.0.0' }); // below floor
  await checkServerVersionOnce(read, logger);
  await checkServerVersionOnce(read, logger); // second op: must not warn again
  await checkServerVersionOnce(read, logger);
  assert.strictEqual(calls.warn.length, 1, `expected exactly one warn, got ${calls.warn.length}`);
  assert.strictEqual(calls.debug.length, 0);
});

await checkAsync('ONCE: an in-range version is silent (no warn, no debug)', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  await checkServerVersionOnce(async () => ({ version: '26.7.0' }), logger);
  assert.strictEqual(calls.warn.length, 0);
  assert.strictEqual(calls.debug.length, 0);
});

await checkAsync('READ FAILURE: getServerVersion {error} yields one debug, zero warn, no throw', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  await checkServerVersionOnce(async () => ({ error: 'network-failure' }), logger);
  assert.strictEqual(calls.warn.length, 0);
  assert.strictEqual(calls.debug.length, 1);
});

await checkAsync('READ FAILURE: a thrown/rejected read yields one debug, zero warn, no throw', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  await assert.doesNotReject(() => checkServerVersionOnce(async () => { throw new Error('boom'); }, logger));
  assert.strictEqual(calls.warn.length, 0);
  assert.strictEqual(calls.debug.length, 1);
});

check('PURITY: the guard source emits only through the passed logger, never console.*', () => {
  // Protects stdio JSON-RPC framing: any stray console write to stdout corrupts it.
  const src = readFileSync(join(ROOT, 'src', 'lib', 'server-version-guard.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/console\.(log|warn|error|info|debug)/.test(code), 'guard must not call console.* directly');
});

console.log(`\n[server-version-guard] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
