// tests/unit/unit_chain_membership.test.js
//
// #321: two guards that protect every OTHER guard in this directory.
//
// 1. CHAIN MEMBERSHIP. `test:unit-js` in package.json is a hand-maintained
//    `node A && node B && ...` chain with no glob. A test file that is never
//    added simply never runs, in CI or in the mandatory pre-commit sequence,
//    while still reading as coverage to anyone who sees the file exists. Two
//    files were already orphaned this way (server_info and transfers_create);
//    both pass and are added by this ticket. A guard that is never executed is
//    worse than no guard, and #325 lost three review passes to exactly that
//    class of defect, so the membership rule is itself a test.
//
// 2. HERMETICITY. No unit test may enumerate the LIVE @actual-app/api module's
//    exported keys to build a coverage or gap assertion. That is what made
//    check_coverage.test.js non-hermetic: its result changed with no commit,
//    26.8.0 turned it red, and the auto-release train died for two nights while
//    security PR #319 stayed blocked.
//
//    The rule is SCOPED to enumeration, deliberately. Importing the package to
//    monkeypatch it for mocking is correct and is what 20 existing unit tests
//    do. An earlier draft of this guard banned the import outright, which would
//    have condemned every one of them.
//
// Run: node tests/unit/unit_chain_membership.test.js

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** Bare filenames that are allowed to sit outside the chain, each mapped to a
 *  NON-EMPTY reason. Ships empty: both known orphans pass and were simply added
 *  rather than excused. An entry here is a deliberate, explained exception. */
export const KNOWN_UNRUN = {};

/** Test files present on disk but absent from the `test:unit-js` chain. */
export function missingFromChain({ chain, diskFiles, allowlist = {} }) {
  const listed = new Set(
    [...String(chain ?? '').matchAll(/tests\/unit\/([A-Za-z0-9._-]+\.test\.js)/g)].map((m) => m[1]),
  );
  return (diskFiles ?? [])
    .filter((f) => !listed.has(f) && !Object.prototype.hasOwnProperty.call(allowlist, f))
    .sort();
}

/** Allowlist keys whose reason is missing, blank, or not a string. An excuse
 *  without a reason is how an allowlist becomes a dumping ground. */
export function invalidAllowlistEntries(allowlist = {}, diskFiles = null) {
  return Object.entries(allowlist)
    .filter(([name, reason]) =>
      typeof reason !== 'string'
      || reason.trim() === ''
      // An excuse for a file that no longer exists lingers silently otherwise.
      || (Array.isArray(diskFiles) && !diskFiles.includes(name)))
    .map(([k]) => k)
    .sort();
}

function stripComments(src) {
  // Block comments are stripped ONLY when the opener starts a line.
  //
  // An unanchored /\/\*[\s\S]*?\*\// pairs any `/*` inside a STRING with the next
  // `*/` anywhere in the file and deletes everything between. A glob literal such
  // as 'src/tools/*.ts' is enough to trigger it, and residue_pattern.test.js
  // already loses 85 lines that way. Worse, this file's own check name contains
  // `tests/unit/*.test.js`, which paired with a `*/` in a fixture below and blanked
  // two thirds of this file from the scan. That accident, not the line filter, was
  // the only reason this guard did not flag itself: it was passing by luck.
  return String(src ?? '')
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

/** This file necessarily CONTAINS the forbidden shapes, as negative fixtures.
 *  It is exempted from the real-repo scan explicitly rather than by accident;
 *  the fixtures still exercise the detector through the `sources` parameter. */
export const SELF = 'unit_chain_membership.test.js';

/** Files that ENUMERATE the live @actual-app/api module's exported keys.
 *
 *  Two-step so mocking importers are not caught: find the identifier the module
 *  is bound to, then look for Object.keys(<that identifier>). A file that
 *  imports the package and monkeypatches it never matches. */
export function enumerationSites({ sources = {} } = {}) {
  const out = [];
  for (const [name, raw] of Object.entries(sources)) {
    const src = stripComments(raw);
    const binds = [
      ...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*['"]@actual-app\/api['"]\s*\)/g),
      ...src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]@actual-app\/api['"]/g),
      ...src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]@actual-app\/api['"]/g),
    ].map((m) => m[1]);
    // Widened beyond Object.keys: `Object.entries(api).filter(([, v]) => typeof
    // v === 'function')` is a natural rewrite of the exact line that caused the
    // outage, and a keys-only rule would not see it. Fix the class, not the case.
    const SINK = '(?:Object\\.(?:keys|entries|values|getOwnPropertyNames)|Reflect\\.ownKeys)';
    if (binds.some((id) => new RegExp(`${SINK}\\(\\s*${id}\\s*\\)`).test(src))) out.push(name);
  }
  return out.sort();
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CHAIN = pkg.scripts['test:unit-js'];
const DISK = readdirSync(join(HERE)).filter((f) => f.endsWith('.test.js'));

// --- the real repo -----------------------------------------------------------

check('every tests/unit/*.test.js is in the test:unit-js chain', () => {
  const missing = missingFromChain({ chain: CHAIN, diskFiles: DISK, allowlist: KNOWN_UNRUN });
  assert.deepStrictEqual(missing, [],
    `orphaned test files never run in CI or pre-commit: ${missing.join(', ')}`);
});

check('every allowlist entry carries a non-empty reason and names a real file', () => {
  assert.deepStrictEqual(invalidAllowlistEntries(KNOWN_UNRUN, DISK), []);
});

check('this guard is itself in the chain', () => {
  assert.ok(CHAIN.includes('unit_chain_membership.test.js'),
    'the membership guard must run, or it is the very thing it warns about');
});

check('no unit test enumerates the live @actual-app/api surface', () => {
  const sources = Object.fromEntries(
    DISK.filter((f) => f !== SELF).map((f) => [f, readFileSync(join(HERE, f), 'utf8')]),
  );
  const sites = enumerationSites({ sources });
  assert.deepStrictEqual(sites, [],
    `a unit test whose result changes with no commit is not a unit test: ${sites.join(', ')}`);
});

// --- negative fixtures: every case must be able to fail -----------------------

check('NEGATIVE: an unlisted file is detected', () => {
  assert.deepStrictEqual(
    missingFromChain({ chain: 'node tests/unit/a.test.js', diskFiles: ['a.test.js', 'b.test.js'] }),
    ['b.test.js']);
});

check('NEGATIVE: an allowlisted file is excused, but only with a reason', () => {
  assert.deepStrictEqual(
    missingFromChain({ chain: 'node tests/unit/a.test.js', diskFiles: ['a.test.js', 'b.test.js'], allowlist: { 'b.test.js': 'needs a live server' } }),
    []);
  assert.deepStrictEqual(invalidAllowlistEntries({ 'b.test.js': '' }), ['b.test.js']);
  assert.deepStrictEqual(invalidAllowlistEntries({ 'b.test.js': '   ' }), ['b.test.js']);
  assert.deepStrictEqual(invalidAllowlistEntries({ 'b.test.js': undefined }), ['b.test.js']);
});

check('NEGATIVE: a substring filename cannot be mistaken for membership', () => {
  // `foo.test.js` must not be satisfied by `xfoo.test.js` appearing in the chain.
  assert.deepStrictEqual(
    missingFromChain({ chain: 'node tests/unit/xfoo.test.js', diskFiles: ['foo.test.js'] }),
    ['foo.test.js']);
});

check('NEGATIVE: this guard would flag ITSELF but for an explicit exemption', () => {
  // Proves the self-exemption is deliberate. Before this, a stray block-comment
  // pairing was silently blanking the fixtures out of the scan.
  const self = readFileSync(join(HERE, SELF), 'utf8');
  assert.deepStrictEqual(enumerationSites({ sources: { [SELF]: self } }), [SELF],
    'the guard must still detect the shapes it carries; it is excluded by name, not by accident');
});

check('NEGATIVE: a glob literal cannot blank out the scan', () => {
  // The historical accident: `/*` inside a string paired with a later `*/`.
  const withGlob = [
    "import * as api from '@actual-app/api';",
    "const glob = 'src/tools/*.ts';",
    'const methods = Object.keys(api);',
    "const other = 'a */ b';",
  ].join('\n');
  assert.deepStrictEqual(enumerationSites({ sources: { 'g.js': withGlob } }), ['g.js'],
    'a glob literal must not hide a real enumeration');
});

check('NEGATIVE: the wider enumeration sinks are detected', () => {
  for (const sink of ['Object.entries(api)', 'Object.values(api)', 'Object.getOwnPropertyNames(api)', 'Reflect.ownKeys(api)']) {
    const src = `import * as api from '@actual-app/api';\nconst m = ${sink};`;
    assert.deepStrictEqual(enumerationSites({ sources: { 'x.js': src } }), ['x.js'], sink);
  }
});

check('NEGATIVE: the enumeration shape is detected in all three binding forms', () => {
  const dyn = "const A = await import('@actual-app/api');\nconst m = Object.keys(A);";
  const star = "import * as B from '@actual-app/api';\nconst m = Object.keys(B);";
  const def = "import C from '@actual-app/api';\nconst m = Object.keys(C);";
  assert.deepStrictEqual(enumerationSites({ sources: { 'a.js': dyn } }), ['a.js']);
  assert.deepStrictEqual(enumerationSites({ sources: { 'b.js': star } }), ['b.js']);
  assert.deepStrictEqual(enumerationSites({ sources: { 'c.js': def } }), ['c.js']);
});

check('NEGATIVE: a MOCKING importer is NOT flagged', () => {
  // This is the case an earlier draft of the rule got wrong: it would have
  // condemned the 20 unit tests that import the package to monkeypatch it.
  const mocking = "import * as api from '@actual-app/api';\napi.getAccounts = async () => [];\nconst k = Object.keys(someOtherThing);";
  assert.deepStrictEqual(enumerationSites({ sources: { 'mock.js': mocking } }), []);
});

check('NEGATIVE: prose about the rule is not flagged', () => {
  // The guard must not trip on files that DISCUSS it, including this one and
  // check_coverage.test.js, both of which name the package in comments.
  const prose = "// const A = await import('@actual-app/api'); Object.keys(A) is banned\n/* Object.keys(A) */\nconst x = 1;";
  assert.deepStrictEqual(enumerationSites({ sources: { 'prose.js': prose } }), []);
});

console.log(`\n[unit-chain-membership] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
