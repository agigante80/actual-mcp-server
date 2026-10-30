// tests/unit/docs_index.test.js
//
// #605: the docs:check "index" module (scripts/docs/index.mjs). docs/README.md is
// the index of the docs tree; every docs/**/*.md page except the index itself,
// docs/plans/** and docs/audit/** must be linked from it, or the module reports
// `not in index: <path>`. Broken links in the index are the links module's job.
//
// Every scenario runs against a temp tree (not a git checkout, so the shared
// enumerator takes its recursive-walk path). The last check runs the module on the
// real repo, where the index must cover every tracked page.
//
// Run: node tests/unit/docs_index.test.js

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { check as checkIndex, name as moduleName } from '../../scripts/docs/index.mjs';

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
  const tmp = mkdtempSync(join(tmpdir(), 'docs-index-'));
  fixtures.push(tmp);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), content);
  }
  return tmp;
}

const PAGES = {
  'docs/roadmap.md': '# Roadmap\n',
  'docs/guides/upgrading.md': '# Upgrading\n',
  'docs/reference/configuration.md': '# Configuration\n',
};

console.log('\n[docs index]');

await check('module name is "index"', async () => {
  assert.strictEqual(moduleName, 'index');
});

await check('a complete index passes', async () => {
  const root = tree({
    ...PAGES,
    'docs/README.md': [
      '# Docs',
      '- [Roadmap](roadmap.md)',
      '- [Upgrading](./guides/upgrading.md#steps)',
      '- [Configuration](reference/configuration.md)',
      '',
    ].join('\n'),
  });
  const { name, problems } = await checkIndex({ root });
  assert.strictEqual(name, 'index');
  assert.deepStrictEqual(problems, []);
});

await check('a page the index omits is reported', async () => {
  const root = tree({
    ...PAGES,
    'docs/README.md': '# Docs\n- [Roadmap](roadmap.md)\n- [Configuration](reference/configuration.md)\n',
  });
  const { problems } = await checkIndex({ root });
  assert.deepStrictEqual(problems, ['not in index: docs/guides/upgrading.md']);
});

await check('pages under plans/ and audit/ are not required', async () => {
  const root = tree({
    'docs/roadmap.md': '# Roadmap\n',
    'docs/plans/p.md': '# Plan\n',
    'docs/audit/a.md': '# Audit\n',
    'docs/README.md': '# Docs\n- [Roadmap](roadmap.md)\n',
  });
  const { problems } = await checkIndex({ root });
  assert.deepStrictEqual(problems, []);
});

await check('markdown outside docs/ is not required', async () => {
  const root = tree({
    'README.md': '# Root\n',
    'scripts/README.md': '# Scripts\n',
    'docs/README.md': '# Docs\n',
  });
  const { problems } = await checkIndex({ root });
  assert.deepStrictEqual(problems, []);
});

await check('an external URL with the same path does not count as a link', async () => {
  const root = tree({
    'docs/roadmap.md': '# Roadmap\n',
    'docs/README.md': '# Docs\n- [Elsewhere](https://example.com/docs/roadmap.md)\n',
  });
  const { problems } = await checkIndex({ root });
  assert.deepStrictEqual(problems, ['not in index: docs/roadmap.md']);
});

await check('a missing docs/README.md reports every page', async () => {
  const root = tree({ 'docs/roadmap.md': '# Roadmap\n' });
  const { problems } = await checkIndex({ root });
  assert.deepStrictEqual(problems, ['index missing: docs/README.md', 'not in index: docs/roadmap.md']);
});

await check('the real repo index links every page in scope', async () => {
  const { problems } = await checkIndex({ root: ROOT });
  assert.deepStrictEqual(problems, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
