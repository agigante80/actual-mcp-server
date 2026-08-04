// tests/unit/train_preflight.test.js
//
// #324: the six pre-flight controls that decide whether the release train may
// run. All pure, so the whole decision table is testable without a registry, a
// clock, or a workflow run.
//
// The denylist is a two-sided contract: a committed file written by a documented
// procedure and consumed by a workflow. Untested, it fails silently in precisely
// the situation it exists for, mid-incident, when nobody is reading carefully.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseTriple, isPrerelease, compareTriples, parseDenylist,
  resolveSoakWindowHours, isSoaked, bumpTypeFor, decidePreflight,
  REFUSAL_REASONS, SOAK_FLOOR_HOURS,
} from '../../scripts/train-preflight.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const base = {
  current: '26.7.0',
  latest: '26.8.0',
  denylistText: '',
  publishedAt: '2026-08-01T00:00:00Z',
  now: '2026-08-04T00:00:00Z',
  soakWindowRaw: '48',
};
const decide = (over = {}) => decidePreflight({ ...base, ...over });

// --- the happy path ----------------------------------------------------------

check('a clean forward move proceeds', () => {
  const d = decide();
  assert.strictEqual(d.updateNeeded, true);
  assert.strictEqual(d.refusalReason, '');
  assert.strictEqual(d.error, null);
});

// --- control 1: validity, the only RED disposition ---------------------------

check('an invalid LATEST is RED, never a silent no-op', () => {
  // Verified: `printf '%s\n%s\n' "26.8.0" "" | sort -V | tail -1` returns 26.8.0,
  // so an empty LATEST would make a sort-based direction check report a quiet
  // "refusing to downgrade". A multi-night registry outage would go totally
  // silent, which is verbatim the defect #325 exists to eliminate.
  for (const bad of ['', '   ', 'undefined', 'not-a-version', null]) {
    const d = decide({ latest: bad });
    assert.ok(d.error, `${JSON.stringify(bad)} must produce an error, got ${JSON.stringify(d)}`);
    assert.strictEqual(d.refusalReason, '', 'a red run must not masquerade as a refusal');
  }
});

check('an invalid CURRENT is RED too', () => {
  // `node -p "({}).x"` prints the literal string "undefined" (verified), and the
  // workflow computes CURRENT exactly that way, so a package.json missing the key
  // yields "undefined" and every downstream comparison is garbage.
  for (const bad of ['undefined', '', 'x.y.z']) {
    assert.ok(decide({ current: bad }).error, `${JSON.stringify(bad)} must be red`);
  }
});

// --- control 2: equality -----------------------------------------------------

check('equal versions report up_to_date, not a forward move', () => {
  // sort -V | tail -1 on two equal values returns that value, which equals
  // LATEST, so a naive direction check would fire update_needed and the train
  // would branch, no-op install, bump and publish a release with no dependency
  // change, every night.
  assert.strictEqual(decide({ current: '26.8.0', latest: '26.8.0' }).refusalReason, 'up_to_date');
});

check('a caret in CURRENT does not defeat the equality check', () => {
  assert.strictEqual(decide({ current: '^26.8.0', latest: '26.8.0' }).refusalReason, 'up_to_date');
});

// --- control 3: prerelease ---------------------------------------------------

check('a prerelease on the latest dist-tag is refused', () => {
  // sort -V ranks 26.8.0-alpha.1 ABOVE 26.8.0 (verified), the opposite of semver.
  // If the train ever took a prerelease, the NEXT night the move back to the real
  // release would be refused as backwards and the repo would be stuck on a
  // prerelease permanently, no-opping quietly with no failure signal.
  for (const pre of ['26.9.0-alpha.1', '26.9.0-nightly.20260804', '25.6.0-edge.23', '26.9.0+build.1']) {
    const d = decide({ latest: pre });
    assert.strictEqual(d.refusalReason, 'not_forward', pre);
    assert.strictEqual(d.updateNeeded, false, pre);
    assert.ok(!d.error, 'a prerelease is a quiet refusal, not a red run');
  }
});

check('isPrerelease and compareTriples agree with semver, not with sort -V', () => {
  assert.strictEqual(isPrerelease('26.8.0-alpha.1'), true);
  assert.strictEqual(isPrerelease('26.8.0'), false);
  assert.ok(compareTriples('26.8.0', '26.7.0') > 0);
  assert.ok(compareTriples('26.10.0', '26.9.0') > 0, 'numeric, not lexicographic');
  assert.strictEqual(compareTriples('26.8.0', '26.8.0'), 0);
});

// --- control 4: direction ----------------------------------------------------

check('a backwards move is refused', () => {
  // The latest dist-tag is publisher-controlled and CAN move backwards; that is
  // the standard remediation for a bad release, since npm blocks unpublish
  // after 72 hours.
  const d = decide({ current: '26.8.0', latest: '26.7.0' });
  assert.strictEqual(d.refusalReason, 'not_forward');
  assert.strictEqual(d.updateNeeded, false);
});

// --- control 5: denylist -----------------------------------------------------

check('a denylisted version is refused as denied', () => {
  const d = decide({ denylistText: '26.8.0  # broke stdio framing, see #999\n' });
  assert.strictEqual(d.refusalReason, 'denied');
});

check('DENYLIST BEFORE SOAK: a denied AND young version reports denied', () => {
  // The soak clears itself, the denylist does not. Reporting "soaking" would
  // leave an operator waiting for a publish that is never coming.
  const d = decide({
    denylistText: '26.8.0\n',
    publishedAt: '2026-08-04T00:00:00Z',
    now: '2026-08-04T01:00:00Z',
  });
  assert.strictEqual(d.refusalReason, 'denied', 'denied must win over soaking');
});

check('FIXTURE: the denylist format contract', () => {
  const cases = [
    ['26.8.0\n', ['26.8.0'], 'a plain entry'],
    ['26.8.0  # a reason, 2026-08-04\n', ['26.8.0'], 'an entry with a trailing comment'],
    ['# 26.8.0 was bad but is fixed now\n', [], 'a version named ONLY inside a comment must NOT block'],
    ['26.8.0\r\n', ['26.8.0'], 'a CRLF line ending'],
    ['\n\n26.8.0\n\n', ['26.8.0'], 'blank lines are ignored'],
    ['   26.8.0   \n', ['26.8.0'], 'leading and trailing whitespace'],
    ['26.8.0 26.9.0\n', ['26.8.0'], 'only the FIRST token is the entry'],
    ['', [], 'an empty file denies nothing'],
  ];
  for (const [text, want, label] of cases) {
    assert.deepStrictEqual([...parseDenylist(text)].sort(), want.sort(), label);
  }
});

check('matching is EXACT, never substring', () => {
  // A naive `grep -q "$LATEST"` would match a version named inside a comment on
  // an unrelated line and block a perfectly good release.
  const denied = parseDenylist('26.8.0\n');
  assert.strictEqual(denied.has('26.8.0'), true);
  assert.strictEqual(denied.has('26.8.01'), false);
  assert.strictEqual(denied.has('6.8.0'), false);
  assert.strictEqual(decide({ latest: '26.8.10', denylistText: '26.8.1\n' }).refusalReason !== 'denied', true,
    '26.8.1 must not deny 26.8.10');
});

check('the SHIPPED denylist parses to nothing, despite naming a version in prose', () => {
  const text = readFileSync(join(ROOT, '.github', 'actual-api-denylist.txt'), 'utf8');
  assert.deepStrictEqual([...parseDenylist(text)], [],
    'the committed file is all comments; its documentation example must not block a release');
  assert.ok(/FORMAT CONTRACT/.test(text), 'the format contract must travel with the file');
  assert.ok(/ref: `?main`?/i.test(text) || /only the copy .* on main/i.test(text),
    'the file must record that only the copy on main has any effect');
});

// --- control 6: soak ---------------------------------------------------------

check('a release younger than the window is refused as soaking', () => {
  const d = decide({ publishedAt: '2026-08-03T12:00:00Z', now: '2026-08-04T00:00:00Z' });
  assert.strictEqual(d.refusalReason, 'soaking');
});

check('a release older than the window proceeds', () => {
  assert.strictEqual(decide({ publishedAt: '2026-08-01T00:00:00Z' }).updateNeeded, true);
});

check('the soak FAILS CLOSED on unreadable age data', () => {
  // It must never treat missing age data as sufficient age. Failing closed costs
  // only latency on a nightly job with nobody waiting.
  for (const bad of [null, undefined, '', 'not-a-date', 'created']) {
    assert.strictEqual(decide({ publishedAt: bad }).refusalReason, 'soaking',
      `publishedAt ${JSON.stringify(bad)} must refuse, not proceed`);
  }
  assert.strictEqual(isSoaked({ publishedAt: null, now: '2026-08-04T00:00:00Z', windowHours: 48 }), false);
});

check('the soak window is clamped to its floor', () => {
  // Repository variables are not code reviewed and no guard test can pin them, so
  // the variable may RAISE the window or lower it only to the floor. It can never
  // silently disable the control by being unset or mistyped.
  for (const raw of [undefined, null, '', '   ', 'abc', '0', '-5', '12']) {
    assert.strictEqual(resolveSoakWindowHours(raw), SOAK_FLOOR_HOURS, JSON.stringify(raw));
  }
  assert.strictEqual(resolveSoakWindowHours('72'), 72, 'raising the window is allowed');
});

// --- bump type ---------------------------------------------------------------

check('an upstream MAJOR bumps us a MINOR, not a patch', () => {
  // Semver describes OUR contract, the 71-tool MCP surface, not our dependency
  // versions. Minor also keeps tilde-pinned consumers off it automatically.
  assert.strictEqual(bumpTypeFor({ current: '26.8.0', latest: '27.0.0' }), 'minor');
  assert.strictEqual(decide({ current: '26.8.0', latest: '27.0.0' }).bumpType, 'minor');
});

check('an upstream minor or patch stays a patch for us', () => {
  assert.strictEqual(bumpTypeFor({ current: '26.7.0', latest: '26.8.0' }), 'patch');
  assert.strictEqual(bumpTypeFor({ current: '26.7.0', latest: '26.7.1' }), 'patch');
});

// --- the enum contract -------------------------------------------------------

check('every refusal reason is in the closed enum', () => {
  const seen = [
    decide().refusalReason,
    decide({ current: '26.8.0', latest: '26.8.0' }).refusalReason,
    decide({ current: '26.8.0', latest: '26.7.0' }).refusalReason,
    decide({ denylistText: '26.8.0\n' }).refusalReason,
    decide({ publishedAt: '2026-08-04T00:00:00Z', now: '2026-08-04T01:00:00Z' }).refusalReason,
  ];
  for (const r of seen) assert.ok(REFUSAL_REASONS.includes(r), `${r} is not in the closed enum`);
  assert.deepStrictEqual([...new Set(seen)].sort(), ['', 'denied', 'not_forward', 'soaking', 'up_to_date']);
});

check('CONTROL ORDER: validity beats equality beats prerelease beats direction', () => {
  // Each assertion pins one adjacency by constructing a state that satisfies two
  // controls at once and asserting which one reports.
  assert.ok(decide({ current: 'undefined', latest: 'undefined' }).error, 'validity outranks equality');
  assert.strictEqual(decide({ current: '26.8.0', latest: '26.8.0', denylistText: '26.8.0\n' }).refusalReason,
    'up_to_date', 'equality outranks denylist');
  assert.strictEqual(decide({ current: '26.9.0', latest: '26.8.0-alpha.1' }).refusalReason,
    'not_forward', 'a prerelease is refused whichever way the comparison would go');
});

console.log(`\n[train-preflight] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
