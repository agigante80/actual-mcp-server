// tests/unit/tools_list_sizes_sync.test.js
//
// #668: scripts/docs/tools-list-sizes.json feeds the README toolset size table, and docs:check
// cannot recompute it (it never starts a child per configuration). This guard measures every
// configuration afresh with scripts/measure-tools-list-size.mjs (the #486 method) and fails,
// printing both numbers, when the committed JSON differs. Needs `npm run build` first.
//
// Run: node tests/unit/tools_list_sizes_sync.test.js

import assert from 'assert';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CONFIGS, diffSizes, measureAll, readCommitted, serializeSizes } from '../../scripts/measure-tools-list-size.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}\n    ${e.message}`);
    failed++;
  }
}

check('NEGATIVE: a size off by one byte is reported with both numbers', () => {
  const a = { c: { bytes: 100, label: 'L', tools: 3 } };
  const b = { c: { bytes: 101, label: 'L', tools: 3 } };
  const d = diffSizes(a, b);
  assert.strictEqual(d.length, 1);
  assert.ok(d[0].includes('100 bytes') && d[0].includes('101 bytes'), d[0]);
});
check('NEGATIVE: a changed tool count, a new and a removed configuration are reported', () => {
  assert.strictEqual(diffSizes({ c: { bytes: 1, label: 'L', tools: 3 } }, { c: { bytes: 1, label: 'L', tools: 4 } }).length, 1);
  assert.strictEqual(diffSizes({}, { n: { bytes: 1, label: 'L', tools: 1 } }).length, 1);
  assert.strictEqual(diffSizes({ o: { bytes: 1, label: 'L', tools: 1 } }, {}).length, 1);
});
check('POSITIVE: identical sizes give no difference and serialize with sorted keys', () => {
  const s = { b: { tools: 2, label: 'B', bytes: 9 }, a: { tools: 1, label: 'A', bytes: 5 } };
  assert.deepStrictEqual(diffSizes(s, s), []);
  const text = serializeSizes(s);
  assert.ok(text.indexOf('"a"') < text.indexOf('"b"') && text.endsWith('\n'));
  assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(s)));
});

if (!existsSync(join(ROOT, 'dist/src/actualToolsManager.js'))) {
  if (process.env.CI) throw new Error('dist required under CI: run npm run build before this test');
  console.log('  skip: dist/ is absent, run npm run build to measure the committed sizes');
} else {
  check('POSITIVE: the committed JSON matches a fresh measurement of every configuration', () => {
    const committed = readCommitted();
    assert.ok(CONFIGS.length >= 5, 'at least five configurations');
    const diffs = diffSizes(committed, measureAll());
    assert.deepStrictEqual(diffs, [], `stale scripts/docs/tools-list-sizes.json:\n    ${diffs.join('\n    ')}\n    run node scripts/measure-tools-list-size.mjs && npm run docs:gen`);
  });
}

console.log(`\n[tools-list-sizes-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
