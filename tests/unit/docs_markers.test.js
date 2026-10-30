// tests/unit/docs_markers.test.js
//
// #602: the docs:check "markers" module (scripts/docs/markers.mjs). A numeric
// `**Version:**` or `**Tool Count:**` marker outside the set scripts/version-bump.js
// rewrites freezes silently; the module must report it, must not report a marker
// inside that set, and must not mistake the bare token in prose for a marker.
//
// Every scenario runs against a temp tree (not a git checkout, so the module takes
// its recursive-walk path), never the real repo. The real repo is covered by the
// enumerator check at the end, which takes the git ls-files path.
//
// Run: node tests/unit/docs_markers.test.js

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { check as checkMarkers, listMarkdownFiles } from '../../scripts/docs/markers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

/** A temp tree from a { 'rel/path.md': 'content' } map. */
function tree(files) {
  const tmp = mkdtempSync(join(tmpdir(), 'docs-markers-'));
  fixtures.push(tmp);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), content);
  }
  return tmp;
}

console.log('\n[docs markers]');

await check('a nested Version marker is reported with its file and line', async () => {
  const root = tree({ 'docs/guides/x.md': '# X\n\n**Version:** 1.2.3\n' });
  const { name, problems } = await checkMarkers({ root });
  assert.strictEqual(name, 'markers');
  assert.deepStrictEqual(problems, ['frozen marker: docs/guides/x.md:3']);
});

await check('a Tool Count marker outside docs/ is reported', async () => {
  const root = tree({ 'scripts/README.md': '# Scripts\n\nintro\n\n**Tool Count:** 84\n' });
  const { problems } = await checkMarkers({ root });
  assert.deepStrictEqual(problems, ['frozen marker: scripts/README.md:5']);
});

await check('markers inside the version-bump set are not reported', async () => {
  const root = tree({
    'docs/ARCHITECTURE.md': '**Version:** 1.2.3\n**Tool Count:** 84\n',
    'README.md': '**Version:** 1.2.3\n',
    '.github/copilot-instructions.md': '**Tool Count:** 84\n',
  });
  const { problems } = await checkMarkers({ root });
  assert.deepStrictEqual(problems, []);
});

await check('the bare token in prose is not a marker', async () => {
  const root = tree({
    'docs/plans/p.md': 'Nested docs carry `**Version:**` markers that version-bump never updates.\n',
  });
  const { problems } = await checkMarkers({ root });
  assert.deepStrictEqual(problems, []);
});

await check('the walk skips node_modules and .git', async () => {
  const root = tree({
    'node_modules/pkg/README.md': '**Version:** 1.2.3\n',
    '.git/x.md': '**Version:** 1.2.3\n',
    'docs/guides/ok.md': 'clean\n',
  });
  assert.deepStrictEqual(listMarkdownFiles(root), ['docs/guides/ok.md']);
});

await check('on the real repo the enumerator lists tracked files, nested ones included', async () => {
  const files = listMarkdownFiles(ROOT);
  assert.ok(files.includes('README.md'), 'README.md must be enumerated');
  assert.ok(files.includes('tests/fixtures/lychee/page.md'), 'nested tracked files must be enumerated');
  assert.ok(!files.some((f) => f.startsWith('node_modules/')), 'node_modules must never be enumerated');
});

console.log(`\n[docs markers] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
