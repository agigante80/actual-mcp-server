// tests/unit/dual_transport_gate.test.js
//
// #280: hardcodes the release gate so it cannot be quietly skipped or deleted.
//
// A promotion to main requires a FULL integration run over BOTH transports with a green
// zero-residue assertion. That requirement lives in three places, and this test fails the
// build if any of them is removed:
//
//   1. scripts/deploy-and-test.sh runs the suite with MCP_TEST_TRANSPORT=http AND =stdio,
//      at the SAME level, and writes .release/dual-transport-report.json.
//   2. CLAUDE.md states the hard rule.
//   3. The release skill states the runnable, artifact-backed precondition.
//
// Every rule is a PURE function over file content, so each is asserted twice: against the
// real file (must PASS) and against an in-memory mutated copy with the line stripped (must
// FAIL). A guard that cannot fail is not a guard; that is the lesson of #278, where a
// "flaky test" was the only thing telling the truth.
//
// Run: node tests/unit/dual_transport_gate.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const DEPLOY = 'scripts/deploy-and-test.sh';
const CLAUDE = 'CLAUDE.md';
const RELEASE_SKILL = '.claude/skills/release/SKILL.md';
const ARTIFACT = '.release/dual-transport-report.json';

/** The literal anchors. Changing these means changing the rule, which is the point. */
export const HARD_RULE_ANCHOR =
  'A promotion to `main` REQUIRES a passing full integration run over BOTH transports';
export const PRECONDITION_ANCHOR =
  'dual-transport evidence';

// ---------------------------------------------------------------------------
// Pure rules: each takes file content and returns boolean.
// ---------------------------------------------------------------------------

export const rules = {
  'deploy script runs the suite over HTTP': (deploy) =>
    /MCP_TEST_TRANSPORT=http\b/.test(deploy),

  'deploy script runs the suite over stdio': (deploy) =>
    /MCP_TEST_TRANSPORT=stdio\b/.test(deploy),

  'both transport runs use the SAME level variable': (deploy) => {
    // Nobody may run stdio at `sanity` while HTTP runs `full`. Each transport's invocation
    // block must pass the shell's "$TEST_LEVEL", never a hardcoded level.
    // The runner takes positional args (URL, TOKEN, LEVEL, CLEANUP), so scan the whole
    // invocation block rather than the first quoted argument after index.js.
    const blocks = [...deploy.matchAll(/MCP_TEST_TRANSPORT=(http|stdio)([\s\S]{0,900}?)\n\s*(?:HTTP_EXIT|STDIO_EXIT)=\$\?/g)];
    if (blocks.length < 2) return false;
    const transports = new Set(blocks.map((b) => b[1]));
    if (!transports.has('http') || !transports.has('stdio')) return false;
    return blocks.every((b) => /"\$TEST_LEVEL"/.test(b[2]));
  },

  'deploy script writes the release evidence artifact': (deploy) =>
    deploy.includes(ARTIFACT.replace('.release/', '')) && deploy.includes('.release'),

  'CLAUDE.md carries the literal hard rule': (claude) =>
    claude.includes(HARD_RULE_ANCHOR),

  'release skill carries the artifact-backed precondition': (skill) =>
    skill.includes(PRECONDITION_ANCHOR) && skill.includes(ARTIFACT),
};

// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[dual-transport-gate]');

const deploy = read(DEPLOY);
const claude = read(CLAUDE);
const skill = read(RELEASE_SKILL);

const sources = {
  'deploy script runs the suite over HTTP': deploy,
  'deploy script runs the suite over stdio': deploy,
  'both transport runs use the SAME level variable': deploy,
  'deploy script writes the release evidence artifact': deploy,
  'CLAUDE.md carries the literal hard rule': claude,
  'release skill carries the artifact-backed precondition': skill,
};

// What to strip from each source to prove the rule can FAIL.
const breakers = {
  'deploy script runs the suite over HTTP': (s) => s.replace(/MCP_TEST_TRANSPORT=http/g, 'MCP_TEST_TRANSPORT=xxxx'),
  'deploy script runs the suite over stdio': (s) => s.replace(/MCP_TEST_TRANSPORT=stdio/g, 'MCP_TEST_TRANSPORT=xxxx'),
  // Point the stdio run at a hardcoded level instead of $TEST_LEVEL.
  'both transport runs use the SAME level variable': (s) =>
    s.replace(/(MCP_TEST_TRANSPORT=stdio[\s\S]{0,600}?tests\/manual\/index\.js[\s\S]{0,200}?)"\$TEST_LEVEL"/, '$1"sanity"'),
  'deploy script writes the release evidence artifact': (s) => s.replace(/\.release/g, '/tmp/nowhere'),
  'CLAUDE.md carries the literal hard rule': (s) => s.replace(HARD_RULE_ANCHOR, 'some weaker suggestion'),
  'release skill carries the artifact-backed precondition': (s) => s.split(ARTIFACT).join('nothing.json'),
};

for (const [label, rule] of Object.entries(rules)) {
  const src = sources[label];

  check(`${label} (real file passes)`, () => {
    assert.ok(rule(src), `rule is not satisfied by the real file; the gate is not in place`);
  });

  check(`${label} (mutated fixture FAILS, so the guard has teeth)`, () => {
    const broken = breakers[label](src);
    assert.notStrictEqual(broken, src, 'breaker did not modify the source, so this proves nothing');
    assert.ok(!rule(broken), 'rule still passed after the requirement was removed: this guard cannot fail');
  });
}

check('the misleading "both transports covered" comment is gone', () => {
  // #280: the old comment claimed parity while stdio ran four read-only calls.
  assert.ok(!/both transports covered/i.test(deploy), 'deploy-and-test.sh still oversells stdio coverage');
  assert.ok(!/both transports are exercised every run/i.test(deploy), 'stale parity claim remains');
});

check('.release/ is gitignored (evidence is local, never committed)', () => {
  const gitignore = read('.gitignore');
  assert.ok(/^\.release\/?$/m.test(gitignore), '.release/ must be gitignored');
});

console.log(`\n[dual-transport-gate] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
