// tests/unit/server_version_guard.test.js
//
// #276: the Actual Budget server-version compatibility warning. Covers the pure comparator
// truth table, fail-open on unparseable input, the once-guard, and that the warning path
// emits ONLY through the passed logger (never console.*), so stdio JSON-RPC framing on
// stdout is never corrupted. Mirrors tests/unit/node_version_guard.test.js.
//
// Run: node tests/unit/server_version_guard.test.js

import assert from 'assert';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const {
  parseVersion, checkServerVersion, checkServerVersionOnce, _resetForTests,
} = await import('../../dist/src/lib/server-version-guard.js');
const { SUPPORTED_ACTUAL_SERVER_RANGE } = await import('../../dist/src/lib/constants.js');
const { readVersionFromTree } = await import('../../dist/src/lib/installed-api-version.js');

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
/** #439: the bundled-api literal every once-guard call pins, so no assertion in
 *  the blocking chain depends on the installed node_modules (#321). */
const BUNDLED = '26.8.1';

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
  // Pinned like every other assertion in this file (#439): unpinned, this reads
  // the live install and reports "server ahead of bundled" for any api below
  // 25.5, which is a real state during a denylist rollback.
  const v = checkServerVersion('25.5.0', RANGE, BUNDLED);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.message, undefined);
});

check('TRUTH TABLE: the low and high in-range boundaries are ok', () => {
  // The third argument is pinned here for the same reason it is pinned on every
  // once-guard call (#439): omitted, it defaults to the LIVE installed
  // @actual-app/api version. `26.99.99` is above every real 26.x api, so without
  // the pin this pre-existing assertion goes red against any actual install. The
  // hermeticity requirement covers COMPARATOR call sites too, not only the six
  // once-guard ones; this case is the proof, since it failed the moment the
  // parameter landed.
  assert.strictEqual(checkServerVersion('25.0.0', RANGE, BUNDLED).ok, true);  // exactly min
  assert.strictEqual(checkServerVersion('26.99.99', RANGE, '26.99.99').ok, true); // top of tested major
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
  // The third argument is pinned on EVERY call in this file (#439). Omitting it
  // defaults to the live resolved @actual-app/api version, which would make an
  // in-chain assertion depend on what happens to be installed (#321). This case
  // is structurally immune (below-min wins for any bundled value) but is pinned
  // anyway, so a future edit to the branch order cannot quietly re-couple it.
  await checkServerVersionOnce(read, logger, BUNDLED);
  await checkServerVersionOnce(read, logger, BUNDLED); // second op: must not warn again
  await checkServerVersionOnce(read, logger, BUNDLED);
  assert.strictEqual(calls.warn.length, 1, `expected exactly one warn, got ${calls.warn.length}`);
  assert.strictEqual(calls.debug.length, 0);
});

await checkAsync('ONCE: an in-range version is silent (no warn, no debug)', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  // THE one case that genuinely flips without an explicit bundled version: with
  // the default it is green only while the installed api is 26.7 or above, so a
  // denylist rollback to a 26.6.x api would turn this pre-existing assertion red
  // during the rollback itself, which is exactly when a mystery red test costs
  // the most. Pinned to a literal at or below the server version under test.
  await checkServerVersionOnce(async () => ({ version: '26.7.0' }), logger, '26.7.0');
  assert.strictEqual(calls.warn.length, 0);
  assert.strictEqual(calls.debug.length, 0);
});

await checkAsync('READ FAILURE: getServerVersion {error} yields one debug, zero warn, no throw', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  await checkServerVersionOnce(async () => ({ error: 'network-failure' }), logger, BUNDLED);
  assert.strictEqual(calls.warn.length, 0);
  assert.strictEqual(calls.debug.length, 1);
});

await checkAsync('READ FAILURE: a thrown/rejected read yields one debug, zero warn, no throw', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  await assert.doesNotReject(() => checkServerVersionOnce(async () => { throw new Error('boom'); }, logger, BUNDLED));
  assert.strictEqual(calls.warn.length, 0);
  assert.strictEqual(calls.debug.length, 1);
});

// --- #439: the server is ahead of the api this build bundles ----------------

check('#439: a server ahead by a MINOR warns, naming both versions', () => {
  // The #427 shape. Actual ships schema changes in MINOR releases (26.9.0 added
  // account_group_id), so this is the condition worth telling an operator about.
  const v = checkServerVersion('26.9.0', RANGE, '26.8.1');
  assert.strictEqual(v.ok, false);
  assert.ok(v.message.includes('26.9.0'), 'names the server version');
  assert.ok(v.message.includes('26.8.1'), 'names the bundled api version');
  assert.ok(/bundles/.test(v.message), 'is the newer-than-bundled branch, not another one');
  assert.ok(!/\b24\b|\b48\b/.test(v.message), 'no soak-window literal: that number lives in the train script and would drift');
});

check('#439: equal, behind, and patch-ahead are all SILENT', () => {
  // MAJOR.MINOR only. Actual server patches ship independently of api patches, so
  // comparing patches would be pure false-positive volume and catch nothing. The
  // condition is already true for a multi-day window most months, and a warning
  // that fires on healthy deployments is one operators learn to ignore.
  assert.strictEqual(checkServerVersion('26.8.1', RANGE, '26.8.1').ok, true, 'equal');
  assert.strictEqual(checkServerVersion('26.8.0', RANGE, '26.9.0').ok, true, 'server behind');
  assert.strictEqual(checkServerVersion('26.8.2', RANGE, '26.8.1').ok, true, 'patch ahead only');
  assert.strictEqual(checkServerVersion('26.8.9', RANGE, '26.8.1').ok, true, 'many patches ahead');
});

check('#439: PRECEDENCE, the tested-major branch still wins when both match', () => {
  // Server 27.0.0 against bundled 26.9.0 satisfies BOTH upper bounds, and the
  // verdict is single-valued, so the order is decided here rather than discovered.
  // Asserted on a substring UNIQUE to that branch: /newer/i alone matches both
  // messages, so the pre-existing assertion could not tell them apart.
  const v = checkServerVersion('27.0.0', RANGE, '26.9.0');
  assert.strictEqual(v.ok, false);
  assert.ok(v.message.includes('tested up to major'), 'the existing branch keeps priority');
  assert.ok(!/bundles/.test(v.message), 'exactly one message is returned');
});

check('#439: an unresolvable bundled version is silent, never a sentinel', () => {
  // null is a NORMAL state, not an error: the resolver fails open by design, and
  // a build that cannot resolve its own dependency must not start warning. Note a
  // caret RANGE is treated as unresolvable too, which is deliberate: parseVersion
  // returns null for it, so a caller that accidentally passes the declared range
  // from package.json gets silence rather than a nonsense comparison.
  for (const bundled of [null, '', 'not-a-version', '^26.9.0']) {
    assert.strictEqual(checkServerVersion('26.9.0', RANGE, bundled).ok, true, JSON.stringify(bundled));
  }
});

check('#439: an OMITTED third argument uses the live install, which is why callers pin it', () => {
  // Documents the hazard rather than hiding it. `undefined` is not "unresolvable":
  // JS default parameters fire on it, so an omitted or explicitly-undefined
  // argument silently reaches for the installed version. That is correct for
  // production (the adapter wants the real value) and forbidden in the blocking
  // test chain (#321), which is why every assertion in this file passes a literal.
  // Asserted WITHOUT depending on what is installed: compare the two defaulted
  // forms to each other rather than to a fixed verdict. Both reach for the same
  // resolved value, so they agree at every possible install, while a naive
  // "and the verdict is ok" assertion here would itself be version-dependent.
  // That mistake was made and caught in this file's own implementation: the first
  // draft asserted a verdict and went red when the resolved version was swapped.
  const omitted = checkServerVersion('25.5.0', RANGE);
  const explicitUndefined = checkServerVersion('25.5.0', RANGE, undefined);
  assert.deepStrictEqual(explicitUndefined, omitted, 'undefined takes the default, it does not mean null');
  // Whereas an explicit null genuinely means "unresolvable" and is always silent.
  assert.strictEqual(checkServerVersion('25.5.0', RANGE, null).ok, true);
});

check('#439: the below-minimum branch still outranks the new one', () => {
  const v = checkServerVersion('24.0.0', RANGE, '26.8.1');
  assert.strictEqual(v.ok, false);
  assert.ok(/older/i.test(v.message), 'below-min keeps top precedence');
});

await checkAsync('#439: the once-guard fires the new warning exactly once per process', async () => {
  _resetForTests();
  const { logger, calls } = spyLogger();
  const read = async () => ({ version: '26.9.0' });
  await checkServerVersionOnce(read, logger, '26.8.1');
  await checkServerVersionOnce(read, logger, '26.8.1');
  await checkServerVersionOnce(read, logger, '26.8.1');
  assert.strictEqual(calls.warn.length, 1, 'per PROCESS, not per condition');
  assert.strictEqual(calls.debug.length, 0);
  assert.ok(calls.warn[0].includes('26.8.1'));
});

check('#439: the resolver walks up to the NAME-matched manifest, over a synthetic tree', () => {
  // Never against the live node_modules: an in-chain assertion may not depend on
  // what is installed (#321). A fixture tree also lets the walk itself be tested,
  // which resolving the real package cannot do.
  const tmp = mkdtempSync(join(tmpdir(), 'apiver-'));
  const nested = join(tmp, 'node_modules', '@actual-app', 'api', 'dist');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'some-host-app', version: '9.9.9' }));
  writeFileSync(join(tmp, 'node_modules', '@actual-app', 'api', 'package.json'), JSON.stringify({ name: '@actual-app/api', version: '26.8.1' }));
  assert.strictEqual(readVersionFromTree(nested), '26.8.1', 'walks up from dist/ to the package manifest');
  // A tree with no matching manifest resolves to null rather than to the host app's
  // version, which is the failure that would report a wrong version confidently.
  assert.strictEqual(readVersionFromTree(join(tmp, 'node_modules')), null, 'a non-matching manifest is never accepted');
  rmSync(tmp, { recursive: true, force: true });
});

check('PURITY: neither source emits except through the passed logger, never console.*', () => {
  // Protects stdio JSON-RPC framing: any stray console write to stdout corrupts it.
  // #439 added installed-api-version.ts to this scan. It is the file that actually
  // performs I/O and swallows errors, it loads inside the stdio process (the
  // adapter statically imports the guard, which imports it), and it has NO logger
  // to route through, so a stray write there would corrupt framing with nothing
  // else in the chain able to catch it.
  for (const file of ['server-version-guard.ts', 'installed-api-version.ts']) {
    const src = readFileSync(join(ROOT, 'src', 'lib', file), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/console\.(log|warn|error|info|debug)/.test(code), `${file} must not call console.* directly`);
    assert.ok(!/process\.(stdout|stderr)\.write/.test(code), `${file} must not write to stdout or stderr directly`);
  }
});

console.log(`\n[server-version-guard] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
