// tests/unit/server_version_guard.test.js
//
// #276: the Actual Budget server-version compatibility warning. Covers the pure comparator
// truth table, fail-open on unparseable input, the once-guard, and that the warning path
// emits ONLY through the passed logger (never console.*), so stdio JSON-RPC framing on
// stdout is never corrupted. Mirrors tests/unit/node_version_guard.test.js.
//
// Run: node tests/unit/server_version_guard.test.js

import assert from 'assert';
import { spawnSync } from 'child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const {
  parseVersion, checkServerVersion, checkServerVersionOnce, _resetForTests,
  SERVER_VERSION_PROBE_TIMEOUT_MS,
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

check('PURITY: the guard loads with a BARE environment (no ACTUAL_* vars)', () => {
  // BEHAVIOURAL, not syntactic. Three earlier versions of this guard parsed the import
  // statements with a regex, and review walked past each one in turn: side-effect imports, then
  // re-exports, then tight spacing and dynamic import(). The last version was ALSO producing
  // false positives, matching specifiers inside comments in a heavily-commented file. Every fix
  // made the pattern longer and the next hole smaller but not absent.
  //
  // So assert the PROPERTY instead of its syntax: load the built module in a child process with
  // the environment stripped, and require it to succeed. Any LOAD-TIME edge to config.ts, however
  // it is spelled, makes that child exit non-zero, because config.ts Zod-validates the
  // environment at module load and hard-exits. No spelling evades it and no comment triggers it,
  // which is what the three regex versions could not manage.
  //
  // Deliberate limit, stated so it is not mistaken for a hole: a LAZY `await import('config')`
  // inside a function body is not caught, because it does not run at load. That is correct
  // rather than a gap: the property being asserted is that this module LOADS without an
  // environment, and a lazy import does not break it.
  //
  // Verified by mutation (each with the import genuinely used, so tsc does not elide it):
  // `import{x}from'./opTimeout.js'` and `import './opTimeout.js'` both take this file to exit 1.
  //
  // Why it matters: this module is imported directly by THIS file, which is in the blocking
  // test:unit-js chain, and CI exports dummy ACTUAL_* vars for that step. So a config edge is
  // green in CI and red only on the documented local pre-commit sequence, which is the worst
  // place for a failure to hide.
  const bareEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('ACTUAL_') && k !== 'MCP_BRIDGE_DATA_DIR'),
  );
  // `timeout` matters: one impurity class (a load-time setInterval, an open socket, an unresolved
  // top-level await) keeps the child alive forever, and without a bound spawnSync would BLOCK the
  // blocking unit chain with no output instead of failing it. A timed-out child reports status
  // null and signal SIGTERM, so the message below distinguishes a hang from a config edge.
  const load = (mod) => spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import('./dist/src/lib/${mod}');`],
    { cwd: ROOT, env: bareEnv, encoding: 'utf8', timeout: 30000 },
  );

  // SELF-CHECK FIRST. The regex version this replaced carried one, and dropping it made the new
  // guard unfalsifiable in-suite: its whole detection power rests on the premise that config.ts
  // hard-exits without ACTUAL_* vars. If that premise ever changes (defaults added to the schema,
  // the exit moved behind a NODE_ENV branch, a var renamed past the filter above), the child would
  // exit 0 unconditionally and this check would pass forever while the regression it exists to
  // catch is fully reintroduced. So prove the mechanism can still fail, on every run.
  const control = load('opTimeout.js');
  // Assert the REASON, not merely a non-zero exit. `status !== 0` alone is also satisfied by
  // ERR_MODULE_NOT_FOUND (if the path moves) or by the 30s timeout above (status null), either
  // of which would let the self-check pass while proving nothing about the premise.
  assert.strictEqual(
    control.status, 1,
    `SELF-CHECK FAILED: importing opTimeout.js was expected to exit 1 under a stripped ` +
    `environment, got status ${control.status} signal ${control.signal}. ` +
    `stderr: ${(control.stderr || '').trim().slice(0, 300)}`,
  );
  assert.ok(
    /Missing or invalid environment variables|ACTUAL_SERVER_URL/.test(control.stderr || ''),
    'SELF-CHECK FAILED: opTimeout.js exited 1 but NOT because config.ts rejected the environment, ' +
    'so the premise this whole check rests on no longer holds and the assertion below proves ' +
    `nothing. stderr: ${(control.stderr || '').trim().slice(0, 300)}`,
  );

  const child = load('server-version-guard.js');
  assert.strictEqual(
    child.status, 0,
    child.signal
      ? `server-version-guard.ts HUNG on load (signal ${child.signal}), which means something it ` +
        'imports keeps the event loop alive at module load.'
      : 'server-version-guard.ts must load with no ACTUAL_* environment. It does not, which means ' +
        'something it imports reads the environment at module load (config.ts, most likely ' +
        'reached through opTimeout).\n' +
        `stderr: ${(child.stderr || '').trim().slice(0, 400)}`,
  );

  // The behavioural check cannot see a LOGGER import: loggerFactory loads cleanly under a bare
  // environment, so it would pass here while breaking this module's stated design contract
  // ("the comparator is PURE: no I/O, no logging"). One narrow structural assertion keeps that
  // half, without trying to parse every import spelling, which is what went wrong three times.
  const src = readFileSync(join(ROOT, 'src', 'lib', 'server-version-guard.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Match ANY quoted specifier naming a logger, in any construct: `from './logger.js'`,
  // `import './loggerFactory.js'` (side effect), and `await import('./logger.js')` (dynamic) all
  // count. Those last two are exactly the spellings that defeated the earlier regex versions of
  // this guard, and neither of the other two checks covers them: loggerFactory loads cleanly
  // under a bare environment so the child-process check stays green, and the console.* scan does
  // not look at imports at all. This module has no legitimate reason to NAME a logger module: it
  // takes one as an argument precisely so its callers decide where output goes, which is what
  // keeps stdio JSON-RPC framing intact.
  const loggerSpecifier = /['"][^'"]*logger[^'"]*['"]/i.exec(code);
  assert.strictEqual(
    loggerSpecifier, null,
    'the guard must not reference a logger module (found ' + (loggerSpecifier && loggerSpecifier[0]) +
    '): it takes a logger as an argument so its callers control where output goes, and stdio ' +
    'framing depends on that.',
  );
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

// ---------------------------------------------------------------------------
// #453: the probe must run BEFORE the download, not after a successful operation.
//
// #276 called the guard from `withActualApi` AFTER `rawOperation()` resolved, so the one case
// it would most help could never reach it: a download that FAILS because the server's schema is
// newer than the bundled @actual-app/api (#427). Nothing warned at all when the operation died.
//
// The probe lives at the top of `loadBudgetTracked`, which is the single funnel EVERY budget
// load passes through (enforced by budget_selection_precondition.test.js), rather than in
// `initActualApiForOperation`, which a pooled HTTP session bypasses entirely.
//
// These cases assert ORDER and NON-INTERFERENCE. The verdict itself is covered by the pure
// comparator cases above, so nothing here depends on what version is installed (#321).
// ---------------------------------------------------------------------------
console.log('\n[server-version-guard] #453 probe runs before downloadBudget');

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let events = [];
let versionResult = { version: '99.9.0' };   // far ahead of anything bundled: the #427 shape
let versionBehaviour = 'ok';                 // 'ok' | 'throw' | 'error-object'
let downloadThrows = null;

api.getServerVersion = async () => {
  events.push('probe');
  if (versionBehaviour === 'throw') throw new Error('/info unreachable');
  if (versionBehaviour === 'error-object') return { error: 'network-failure' };
  return versionResult;
};
api.downloadBudget = async () => {
  events.push('download');
  if (downloadThrows) throw downloadThrows;
};
api.getBudgetMonths = async () => { events.push('post-condition'); return ['2026-01']; };
api.init = async () => {};
api.sync = async () => {};

const { loadBudgetTracked } = await import('../../dist/src/lib/budgetLoader.js');
const apiState = await import('../../dist/src/lib/apiState.js');

function resetProbe() {
  events = [];
  versionBehaviour = 'ok';
  downloadThrows = null;
  _resetForTests();                 // the once-guard is per PROCESS; clear it per case
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId(null);
}

async function settle(p) {
  try { await p; return { ok: true }; } catch (err) { return { ok: false, err }; }
}

await (async () => {
  resetProbe();
  const r = await settle(loadBudgetTracked('sync-1'));
  check('the probe runs, and runs BEFORE downloadBudget', () => {
    assert.ok(r.ok, `load should succeed: ${r.err && r.err.message}`);
    assert.strictEqual(events.indexOf('probe'), 0, `expected probe first, got ${events.join(' -> ')}`);
    assert.ok(events.indexOf('probe') < events.indexOf('download'), `order was ${events.join(' -> ')}`);
  });
})();

await (async () => {
  resetProbe();
  // THE CASE THIS TICKET EXISTS FOR: the download fails the way #427 does. The warning must
  // already have been emitted, which is only true because the probe ran first.
  downloadThrows = Object.assign(new Error('This budget could not be loaded'), { code: 'invalid-schema' });
  const r = await settle(loadBudgetTracked('sync-1'));
  check('the probe still runs when the download then FAILS', () => {
    assert.strictEqual(r.ok, false, 'the download failure must still propagate');
    assert.strictEqual(events[0], 'probe', `expected probe first, got ${events.join(' -> ')}`);
    assert.ok(events.includes('download'), 'the download must still be attempted');
  });
})();

await (async () => {
  resetProbe();
  versionBehaviour = 'throw';
  const r = await settle(loadBudgetTracked('sync-1'));
  check('a THROWING probe never breaks the load (advisory means advisory)', () => {
    assert.ok(r.ok, `load should still succeed: ${r.err && r.err.message}`);
    assert.ok(events.includes('download'), `download must still happen, got ${events.join(' -> ')}`);
  });
})();

await (async () => {
  resetProbe();
  versionBehaviour = 'error-object';
  const r = await settle(loadBudgetTracked('sync-1'));
  check('a probe returning {error} never breaks the load', () => {
    assert.ok(r.ok, `load should still succeed: ${r.err && r.err.message}`);
    assert.ok(events.includes('download'));
  });
})();

await (async () => {
  resetProbe();
  await settle(loadBudgetTracked('sync-1'));
  const first = events.filter((e) => e === 'probe').length;
  events = [];
  await settle(loadBudgetTracked('sync-1'));      // deliberately NO _resetForTests here
  const second = events.filter((e) => e === 'probe').length;
  check('the once-guard means a second load does not re-probe', () => {
    assert.strictEqual(first, 1, 'the first load probes exactly once');
    assert.strictEqual(second, 0, 'a later load must not probe again');
  });
})();

// Round 2 review finding: moving the probe BEFORE the download also moved it to the most
// failure-prone moment available. The once-guard latched synchronously, so ONE failed probe
// (a slow or unreachable /info, or the op timeout firing) permanently disabled the warning for
// the whole process, including #276's surviving post-op call site. The deployment that silences
// it that way is exactly the one the guard exists for. Every case above calls _resetForTests(),
// so none of them could see this.
console.log('\n[server-version-guard] #453 a FAILED probe must not disarm the guard');

await (async () => {
  resetProbe();
  versionBehaviour = 'throw';
  await settle(loadBudgetTracked('sync-1'));         // probe fails
  const afterFailure = events.filter((e) => e === 'probe').length;
  events = [];
  versionBehaviour = 'ok';
  await settle(loadBudgetTracked('sync-1'));         // deliberately NO _resetForTests
  const retried = events.filter((e) => e === 'probe').length;
  check('a later load retries after a failed probe', () => {
    assert.strictEqual(afterFailure, 1, 'the failing load probes once');
    assert.strictEqual(retried, 1, 'a failed probe must leave the guard armed');
  });
})();

await (async () => {
  resetProbe();
  versionBehaviour = 'error-object';
  for (let i = 0; i < 6; i++) await settle(loadBudgetTracked('sync-1'));
  check('but repeated failures are BOUNDED, not retried forever', () => {
    const probes = events.filter((e) => e === 'probe').length;
    assert.ok(probes >= 1 && probes <= 3, `expected at most 3 attempts, got ${probes}`);
    assert.strictEqual(events.filter((e) => e === 'download').length, 6, 'every load still downloads');
  });
})();

await (async () => {
  resetProbe();
  await settle(loadBudgetTracked('sync-1'));         // a SUCCESSFUL probe
  events = [];
  await settle(loadBudgetTracked('sync-1'));
  check('a successful probe still latches permanently', () => {
    assert.strictEqual(events.filter((e) => e === 'probe').length, 0,
      'once a version has actually been read and judged, never ask again');
  });
})();

// The BOUND itself, which was uncovered when it was written. Review deleted it from the built
// output and every suite stayed green, so nothing pinned the one property it exists for.
//
// The failure it prevents is not cosmetic: a half-open socket to /info (the #270 scenario) makes
// the reader never settle, `inFlight` stays true for the life of the process, the warning is
// permanently disabled, and because the guard is no longer wrapped by withOpTimeout the await
// hangs INSIDE withApiLock forever, stalling every session with no error at all. That is the
// #278 lost-lock shape, and it is the reason the bound moved inside the guard rather than being
// left to call sites.
// HOW THIS FAILS when the bound is removed, so the signal is not mistaken for a crash: the
// never-settling read is then awaited forever, nothing else is pending, and Node exits 13 with
// "Detected unsettled top-level await" instead of reaching the summary. A non-zero exit stops the
// &&-joined unit chain, which is the detection. Verified by deleting the bound from the built
// output: exit 13 with the bound gone, exit 0 and 32 passing with it.
console.log('\n[server-version-guard] the internal bound must actually bound');

await (async () => {
  _resetForTests();
  const warns = [];
  const debugs = [];
  const log = { warn: (m) => warns.push(m), debug: (m) => debugs.push(m) };
  const started = Date.now();
  // NEVER settles. Without the bound this await would hang the process.
  await checkServerVersionOnce(() => new Promise(() => {}), log, '26.9.0');
  const elapsed = Date.now() - started;

  check('a never-settling read is abandoned at the bound, not awaited forever', () => {
    assert.ok(
      elapsed >= SERVER_VERSION_PROBE_TIMEOUT_MS - 100 && elapsed < SERVER_VERSION_PROBE_TIMEOUT_MS + 2000,
      `expected to give up near ${SERVER_VERSION_PROBE_TIMEOUT_MS}ms, took ${elapsed}ms`,
    );
    assert.strictEqual(warns.length, 0, 'a probe that never answered must not warn about a version');
    assert.strictEqual(debugs.length, 1, `expected exactly one debug line, got ${JSON.stringify(debugs)}`);
  });

  // `checkAsync`, NOT `check`. The synchronous helper discards a returned promise and counts a
  // pass immediately, so the assertion below never ran: review mutated the expected count to 999
  // and the file still reported 32 passed, exit 0. That is the same "a guard nothing can fail"
  // defect this whole section was written to remove, reintroduced in the test that removes it.
  await checkAsync('and the guard is still armed afterwards, so the process is not silenced', async () => {
    // The whole point of latching only on a real answer: a stall must not disable the warning.
    const warns2 = [];
    await checkServerVersionOnce(
      async () => ({ version: '99.9.0' }),
      { warn: (m) => warns2.push(m), debug: () => {} },
      '26.9.0',
    );
    assert.strictEqual(warns2.length, 1, 'a later successful probe must still be able to warn');
  });
})();

check('the bound is a fixed constant, not read from the environment', () => {
  // If this ever becomes configurable it must go through config.ts and the config-drift guard,
  // which would also break the purity property pinned above. Pin the value so the choice is
  // deliberate rather than drifting.
  assert.strictEqual(typeof SERVER_VERSION_PROBE_TIMEOUT_MS, 'number');
  assert.strictEqual(SERVER_VERSION_PROBE_TIMEOUT_MS, 5000);
});

console.log(`\n[server-version-guard] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
