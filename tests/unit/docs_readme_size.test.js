// tests/unit/docs_readme_size.test.js
//
// #607: the docs:check "readme-size" module (scripts/docs/readme-size.mjs). The README is
// also the Docker Hub long description, published by peter-evans/dockerhub-description
// with enable-url-completion, so the module bounds what that upload can grow to, keeps the
// first install block near the top, and rejects the link forms the action cannot complete.
//
// Every case but the real-README one runs against its own temp root holding a README.md
// built to an exact line layout and byte size, and calls check({ root }) directly.
//
// Run: node tests/unit/docs_readme_size.test.js

import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const readmeSize = await import('../../scripts/docs/readme-size.mjs');

const dirs = [];
function tempRoot(readme) {
  const root = mkdtempSync(join(tmpdir(), 'docs-readme-size-'));
  dirs.push(root);
  if (readme !== undefined) writeFileSync(join(root, 'README.md'), readme);
  return root;
}

/**
 * A README with its first runnable bash fence opening on `fenceLine` (the marker sits on
 * the line above), `set` overriding whole lines by 1-based number, padded with filler
 * lines to `lines` lines and then, on the last line, with `x` to exactly `bytes` bytes.
 * fenceLine null leaves no runnable block at all.
 */
function buildReadme({ fenceLine = 10, lines = 60, bytes, set = {} }) {
  const out = Array.from({ length: lines }, (_, i) => `Filler line ${i + 1}.`);
  out[0] = '# Fixture README';
  if (fenceLine !== null) {
    out[fenceLine - 2] = '<!-- runnable: env-token -->';
    out[fenceLine - 1] = '```bash';
    out[fenceLine] = 'echo ok';
    out[fenceLine + 1] = '```';
  }
  for (const [n, text] of Object.entries(set)) out[Number(n) - 1] = text;
  let text = out.join('\n') + '\n';
  if (bytes !== undefined) {
    const short = bytes - Buffer.byteLength(text, 'utf8');
    assert.ok(short >= 0, `fixture already ${-short} bytes over ${bytes}`);
    out[lines - 1] += 'x'.repeat(short);
    text = out.join('\n') + '\n';
  }
  if (bytes !== undefined) assert.strictEqual(Buffer.byteLength(text, 'utf8'), bytes, 'fixture byte size');
  assert.strictEqual(text.split('\n').length - 1, lines, 'fixture line count');
  return text;
}

const problemsFor = async (readme) => (await readmeSize.check({ root: tempRoot(readme) })).problems;

console.log('\n[docs-readme-size]');

await check('module contract: name is readme-size, check() returns { name, problems }, no generate()', async () => {
  assert.strictEqual(readmeSize.name, 'readme-size');
  const result = await readmeSize.check({ root: tempRoot(buildReadme({})) });
  assert.strictEqual(result.name, 'readme-size');
  assert.ok(Array.isArray(result.problems));
  assert.strictEqual(readmeSize.generate, undefined);
});

await check('positive: 23,900 bytes, no relative link, first runnable fence on line 35 passes', async () => {
  assert.deepStrictEqual(await problemsFor(buildReadme({ fenceLine: 35, bytes: 23900 })), []);
});

await check('positive: first runnable fence on exactly line 40 passes', async () => {
  assert.deepStrictEqual(await problemsFor(buildReadme({ fenceLine: 40 })), []);
});

await check('positive: 260 lines and 20,000 bytes pass (there is no line-count rule)', async () => {
  assert.deepStrictEqual(await problemsFor(buildReadme({ fenceLine: 30, lines: 260, bytes: 20000 })), []);
});

await check('positive: absolute and mailto links do not count toward the projected size', async () => {
  const readme = buildReadme({
    fenceLine: 10,
    bytes: 24000,
    set: { 3: '[a](https://example.com/a) [b](http://example.com/b) [c](mailto:)' },
  });
  assert.deepStrictEqual(await problemsFor(readme), []);
});

await check('NEGATIVE: a same-page link counts, since completion rewrites it into a README.md URL', async () => {
  const readme = buildReadme({ fenceLine: 10, bytes: 23901, set: { 3: '[d](#quick-start)' } });
  assert.deepStrictEqual(await problemsFor(readme), [
    'README.md uploads as 24001 bytes (23901 raw plus 1 relative links at 100 bytes each), over the 24000 byte limit',
  ]);
});

await check('positive: the real README passes', async () => {
  const { problems } = await readmeSize.check({ root: ROOT });
  assert.deepStrictEqual(problems, []);
});

await check('positive: readme-size is registered in the real docs:check MODULES list', async () => {
  // run() is exercised with stub modules in docs_check.test.js and never sees MODULES, so
  // registration is read from the source: an unregistered module would never run in CI.
  const src = readFileSync(join(ROOT, 'scripts/docs/check.mjs'), 'utf8');
  assert.match(src, /import \* as readmeSize from '\.\/readme-size\.mjs';/);
  assert.match(src, /const MODULES = \[[^\]]*\breadmeSize\b[^\]]*\];/);
});

await check('NEGATIVE: 23,901 raw bytes plus one relative link projects to 24,001 and fails', async () => {
  const readme = buildReadme({ fenceLine: 10, bytes: 23901, set: { 3: '[guide](docs/guides/upgrading.md)' } });
  assert.deepStrictEqual(await problemsFor(readme), [
    'README.md uploads as 24001 bytes (23901 raw plus 1 relative links at 100 bytes each), over the 24000 byte limit',
  ]);
});

await check('NEGATIVE: first runnable fence on line 41 fails', async () => {
  assert.deepStrictEqual(await problemsFor(buildReadme({ fenceLine: 41 })), [
    'first install block opens at line 41, must open by line 40',
  ]);
});

await check('NEGATIVE: an unmarked bash fence does not count as an install block', async () => {
  const readme = buildReadme({ fenceLine: null, set: { 5: '```bash', 6: 'echo ok', 7: '```' } });
  assert.deepStrictEqual(await problemsFor(readme), ['README.md has no <!-- runnable: <id> --> install block']);
});

await check('NEGATIVE: a missing README is one problem and no other rule runs', async () => {
  assert.deepStrictEqual((await readmeSize.check({ root: tempRoot() })).problems, ['README.md not found']);
});

await check('NEGATIVE: a reference-style link definition fails with its line', async () => {
  const readme = buildReadme({ fenceLine: 10, set: { 14: '[guide]: docs/guides/upgrading.md' } });
  assert.deepStrictEqual(await problemsFor(readme), ['README.md:14: reference-style link definition, use an inline link']);
});

await check('NEGATIVE: a relative link inside a code block fails with its line (any info string)', async () => {
  // Kept far under 24,000 bytes: the link also counts toward the projected size, and this
  // case must report the fence rule alone.
  const readme = buildReadme({ fenceLine: 10, set: { 19: '```text', 20: '[guide](docs/guides/upgrading.md)', 21: '```' } });
  assert.ok(Buffer.byteLength(readme, 'utf8') < 5000);
  assert.deepStrictEqual(await problemsFor(readme), ['README.md:20: relative link inside a code block']);
});

await check('NEGATIVE: <details> fails with its line', async () => {
  const readme = buildReadme({ fenceLine: 10, set: { 50: '<details>' } });
  assert.deepStrictEqual(await problemsFor(readme), ['README.md:50: <details> does not render on Docker Hub']);
});

for (const d of dirs) rmSync(d, { recursive: true, force: true });

console.log(`\n[docs-readme-size] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
