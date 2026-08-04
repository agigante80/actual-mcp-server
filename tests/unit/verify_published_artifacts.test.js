// tests/unit/verify_published_artifacts.test.js
//
// #326: a green pipeline proves the publish JOBS exited 0. It does not prove a
// third-party registry now serves what we think it serves.
//
// Every decision function is pure, so the whole verdict table is testable
// without a registry.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  dockerVersionFor, realPlatforms, assertPlatforms, classifyProbe,
  overallVerdict, detailFor, backoffFor, REQUIRED_PLATFORMS, BUDGETS,
} from '../../scripts/verify-published-artifacts.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const plat = (os, architecture) => ({ platform: { os, architecture } });

// --- the attestation trap ----------------------------------------------------

check('TRAP: attestation entries are filtered before any platform assertion', () => {
  // Verified live against ghcr.io 0.9.3: docker manifest inspect returns FOUR
  // entries, not two. --provenance attaches attestation manifests carrying
  // {"architecture":"unknown","os":"unknown"}.
  const real = {
    manifests: [
      plat('linux', 'amd64'), plat('unknown', 'unknown'),
      plat('linux', 'arm64'), plat('unknown', 'unknown'),
    ],
  };
  assert.deepStrictEqual(realPlatforms(real), ['linux/amd64', 'linux/arm64']);
  assert.strictEqual(assertPlatforms(real).ok, true);
});

check('TRAP: a count-based check would pass a single-arch manifest; set equality does not', () => {
  // amd64 plus two attestations is 3 entries, so "at least 2" passes it. This is
  // exactly the broken artifact the ticket exists to catch.
  const broken = {
    manifests: [plat('linux', 'amd64'), plat('unknown', 'unknown'), plat('unknown', 'unknown')],
  };
  assert.strictEqual(broken.manifests.length >= 2, true, 'a count check would pass this');
  const res = assertPlatforms(broken);
  assert.strictEqual(res.ok, false, 'set equality must reject it');
  assert.deepStrictEqual(res.missing, ['linux/arm64']);
});

check('an unexpected extra platform is also a mismatch', () => {
  const odd = { manifests: [plat('linux', 'amd64'), plat('linux', 'arm64'), plat('linux', 's390x')] };
  const res = assertPlatforms(odd);
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.extra, ['linux/s390x']);
});

check('an empty manifest list is a mismatch, not a pass', () => {
  assert.strictEqual(assertPlatforms({ manifests: [] }).ok, false);
  assert.strictEqual(assertPlatforms({}).ok, false);
  assert.strictEqual(assertPlatforms(null).ok, false);
});

// --- the tag-transform trap --------------------------------------------------

check('TRAP: Docker tags use docker_version, so build metadata becomes a hyphen', () => {
  // A verifier interpolating `version` would look up a nonexistent tag whenever
  // build metadata is present, raising a false P1 on a healthy release.
  assert.strictEqual(dockerVersionFor('0.9.4'), '0.9.4');
  assert.strictEqual(dockerVersionFor('0.9.4+build.7'), '0.9.4-build.7');
  assert.strictEqual(dockerVersionFor('1.0.0+a+b'), '1.0.0-a-b');
});

// --- the three-state probe ---------------------------------------------------

check('a definite 200 is confirmed_present', () => {
  assert.strictEqual(classifyProbe({ status: 200 }), 'confirmed_present');
});

check('a definite E404 on the final attempt is confirmed_absent', () => {
  assert.strictEqual(classifyProbe({ errorCode: 'E404' }), 'confirmed_absent');
  assert.strictEqual(classifyProbe({ status: 404 }), 'confirmed_absent');
});

check('a negative BEFORE the retry budget is exhausted is inconclusive', () => {
  // npm read-after-write is not instant. A check that cries wolf gets ignored,
  // which is worse than not having it.
  assert.strictEqual(classifyProbe({ errorCode: 'E404', attemptsExhausted: false }), 'inconclusive');
});

check('every transient shape is inconclusive, never absent and never present', () => {
  for (const c of [
    { status: 429 }, { status: 500 }, { status: 503 }, { status: 401 }, { status: 403 },
    { errorCode: 'ENOTFOUND' }, { errorCode: 'ECONNRESET' }, { errorCode: 'ETIMEDOUT' },
    { errorCode: 'EAI_AGAIN' }, { errorCode: 'SOMETHING_ELSE' }, { body: 'not json' },
  ]) {
    const v = classifyProbe(c);
    assert.strictEqual(v, 'inconclusive', JSON.stringify(c));
  }
});

check('"the registry said no" and "we could not ask" are different incidents', () => {
  // Both are red, but only the first is a genuine P1. Collapsing them would make
  // every network blip look like a missing artifact.
  assert.notStrictEqual(classifyProbe({ errorCode: 'E404' }), classifyProbe({ status: 503 }));
});

// --- overall verdict ---------------------------------------------------------

check('any absent surface makes the whole verdict artifact_absent', () => {
  assert.strictEqual(overallVerdict({ npm: 'confirmed_present', ghcr: 'confirmed_absent' }), 'artifact_absent');
});

check('absent outranks inconclusive', () => {
  assert.strictEqual(overallVerdict({ npm: 'inconclusive', ghcr: 'confirmed_absent' }), 'artifact_absent');
});

check('any inconclusive surface blocks an ok verdict', () => {
  assert.strictEqual(overallVerdict({ npm: 'confirmed_present', ghcr: 'inconclusive' }), 'inconclusive');
});

check('all present is ok, and an empty result set is NOT ok', () => {
  assert.strictEqual(overallVerdict({ npm: 'confirmed_present', ghcr: 'confirmed_present' }), 'ok');
  assert.strictEqual(overallVerdict({}), 'inconclusive', 'probing nothing must not read as success');
});

check('the detail names which surface failed, and only those', () => {
  const d = detailFor({ npm: 'confirmed_present', ghcr: 'confirmed_absent', dockerhub: 'inconclusive' });
  assert.ok(d.includes('ghcr=confirmed_absent'));
  assert.ok(d.includes('dockerhub=inconclusive'));
  assert.ok(!d.includes('npm='), 'a healthy surface must not be named');
  assert.ok(d.length <= 200, 'the detail must be bounded');
});

// --- retry budgets -----------------------------------------------------------

check('npm gets a longer budget than a registry, and both are capped', () => {
  assert.ok(BUDGETS.npm.attempts > BUDGETS.registry.attempts);
  assert.strictEqual(backoffFor('npm', 0), 5000);
  assert.strictEqual(backoffFor('npm', 3), 40000);
  assert.strictEqual(backoffFor('npm', 9), BUDGETS.npm.capMs, 'beyond the table it caps, never grows');
  assert.strictEqual(backoffFor('registry', 9), BUDGETS.registry.capMs);
});

check('the required platform set is exactly the two we build', () => {
  assert.deepStrictEqual([...REQUIRED_PLATFORMS].sort(), ['linux/amd64', 'linux/arm64']);
});

// --- publish topology is unchanged, and must stay that way -------------------

check('the publish topology is not touched by this ticket', () => {
  // Part 2 is settled: accept npm irreversibility, do NOT stage the publish.
  // `npm dist-tag add` is unsupported by Trusted Publishers (npm/cli#8547), so
  // staging would force a long-lived NPM_TOKEN back into the unattended lane.
  // Comments stripped first: this file's own header EXPLAINS the decision and
  // therefore names both dist-tag and NPM_TOKEN. Asserting over raw source would
  // flag the documentation of the rule as a violation of it.
  const raw = readFileSync(new URL('../../scripts/verify-published-artifacts.mjs', import.meta.url), 'utf8');
  const src = raw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/dist-tag/.test(src), 'no dist-tag manipulation may appear in the verifier');
  assert.ok(!/NPM_TOKEN/.test(src), 'no npm credential may appear: reads need no auth');
});

console.log(`\n[verify-published-artifacts] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
