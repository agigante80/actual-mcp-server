// tests/unit/docs_links_fixture.test.js
//
// #602: the negative fixture for the docs:check "links" module. A link checker that
// reports nothing is indistinguishable from one that checks nothing, so this test
// proves lychee, run with the module's own flags, reports all three broken cases in
// tests/fixtures/lychee/page.md:
//   - a broken cross-file link        docs/NOT_A_FILE.md
//   - a broken cross-file fragment    README.md#not-a-heading
//   - a broken same-file fragment     #missing   (lycheeverse/lychee#1613 territory)
// plus a control run WITHOUT --include-fragments, which must MISS the cross-file
// fragment: that is what makes the flag load-bearing.
//
// The fixture lives in-repo at tests/fixtures/lychee/ (the real docs:check run
// excludes that path) and this test COPIES it into a temp tree, so the module runs
// on a fixture-only tree and never on the real repo. The copy sits at the temp
// tree's root, not under tests/fixtures/lychee, so the exclusion does not hide it.
//
// Without lychee on PATH it prints `skip: lychee not installed` and exits 0. The CI
// `test` job (GitHub sets CI=true there too, with no lychee) relies on that. Only
// when CI is set AND DOCS_CHECK_REQUIRE_LYCHEE=1, as in the `Docs check` job, is a
// missing lychee a failure.
//
// Run: node tests/unit/docs_links_fixture.test.js

import assert from 'node:assert';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as links from '../../scripts/docs/links.mjs';
import { run } from '../../scripts/docs/check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'lychee');

const unavailable = links.lycheeUnavailable();
if (unavailable) {
  const ci = process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
  if (ci && process.env.DOCS_CHECK_REQUIRE_LYCHEE === '1') {
    console.error(`docs_links_fixture: lychee required (DOCS_CHECK_REQUIRE_LYCHEE=1): ${unavailable}`);
    process.exit(1);
  }
  console.log(`skip: ${unavailable}`);
  process.exit(0);
}

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A temp tree holding a copy of the fixture at its root. */
function fixtureTree() {
  const tmp = mkdtempSync(join(tmpdir(), 'docs-links-'));
  fixtures.push(tmp);
  cpSync(FIXTURE, tmp, { recursive: true });
  return tmp;
}

console.log('\n[docs links fixture]');

await check('the orchestrator reports all three broken links and exits 1', async () => {
  const { exitCode, lines } = await run({ root: fixtureTree(), modules: [links], env: {} });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, [
    'links: page.md:5 docs/NOT_A_FILE.md (file not found)',
    'links: page.md:7 README.md#not-a-heading (cannot find fragment)',
    'links: page.md:9 page.md#missing (cannot find fragment)',
  ]);
});

await check('the module returns unprefixed problems', async () => {
  const { name, problems, skipped } = await links.check({ root: fixtureTree() });
  assert.strictEqual(name, 'links');
  assert.strictEqual(skipped, undefined);
  assert.strictEqual(problems.length, 3);
  assert.ok(problems.every((p) => p.startsWith('page.md:')), JSON.stringify(problems));
});

await check('control: without --include-fragments the cross-file fragment is missed', async () => {
  const root = fixtureTree();
  const args = links.LYCHEE_ARGS.filter((a) => a !== '--include-fragments');
  const problems = links.runLychee({ root, files: ['README.md', 'page.md'], args });
  assert.ok(problems.some((p) => p.includes('docs/NOT_A_FILE.md')), 'the dead file is still found');
  assert.ok(!problems.some((p) => p.includes('#not-a-heading')), `fragment must be missed: ${JSON.stringify(problems)}`);
});

await check('the real run excludes tests/fixtures/lychee', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'docs-links-excl-'));
  fixtures.push(tmp);
  mkdirSync(join(tmp, 'tests', 'fixtures'), { recursive: true });
  cpSync(FIXTURE, join(tmp, 'tests', 'fixtures', 'lychee'), { recursive: true });
  writeFileSync(join(tmp, 'README.md'), '# Clean\n\n[ok](tests/fixtures/lychee/README.md)\n');
  const { problems } = await links.check({ root: tmp });
  assert.deepStrictEqual(problems, []);
});

console.log(`\n[docs links fixture] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
