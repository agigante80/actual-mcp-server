// tests/unit/node_polyfill_order.test.js
//
// #232: @actual-app/api reads `navigator` at module load. Node 20 has no native
// `navigator`, so `src/lib/node-polyfills.ts` defines it and MUST be evaluated before
// `@actual-app/api`. This guard enforces the load-order-independent invariant so a new
// module cannot reintroduce the Node 20 `ReferenceError: navigator is not defined`.
//
// Rules (line-anchored matching, so comment/string mentions are ignored):
// - A STATIC importer (`import ... from '@actual-app/api'`) must import `node-polyfills`
//   at an EARLIER line.
// - A DYNAMIC-only importer (`import('@actual-app/api')`, no static import) must statically
//   import a polyfill-loader (`node-polyfills` directly, or `actual-adapter`, which loads it),
//   so the polyfill is evaluated at module load, before the dynamic import runs. Ordering is
//   not required there.
// - A file that only mentions the package in a comment or string is not an importer; skip.
//
// Run: node tests/unit/node_polyfill_order.test.js

import assert from 'assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const STATIC_API = /^\s*import\b[^\n]*\bfrom\s+['"]@actual-app\/api['"]/;
const DYNAMIC_API = /import\(\s*['"]@actual-app\/api['"]\s*\)/;
const POLYFILL = /^\s*import\b[^\n]*node-polyfills/;
const ADAPTER = /^\s*import\b[^\n]*actual-adapter(\.js)?['"]/;

// Classify a file's source. Returns a violation string, or null if compliant/not-an-importer.
function violation(src) {
  const lines = src.split('\n');
  const firstLine = (re) => lines.findIndex((l) => re.test(l));
  const apiLine = firstLine(STATIC_API);
  const polyLine = firstLine(POLYFILL);
  if (apiLine !== -1) {
    if (polyLine === -1) return 'imports @actual-app/api statically with no node-polyfills import';
    if (polyLine >= apiLine) return 'imports @actual-app/api before node-polyfills (wrong order)';
    return null;
  }
  if (DYNAMIC_API.test(src)) {
    if (polyLine === -1 && firstLine(ADAPTER) === -1) {
      return 'dynamically imports @actual-app/api but statically loads no polyfill (node-polyfills or actual-adapter)';
    }
    return null;
  }
  return null; // not an importer
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

console.log('\n[node-polyfill-order]');

check('every src module reaching @actual-app/api loads the navigator polyfill first', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const v = violation(readFileSync(file, 'utf8'));
    if (v) bad.push(`${file.replace(ROOT + '/', '')}: ${v}`);
  }
  assert.strictEqual(bad.length, 0, `polyfill-order violations:\n    ${bad.join('\n    ')}`);
});

check('NEGATIVE: a static @actual-app/api import with no polyfill is flagged', () => {
  const v = violation("import api from '@actual-app/api';\nconst x = 1;\n");
  assert.match(v || '', /no node-polyfills/);
});

check('NEGATIVE: importing @actual-app/api BEFORE node-polyfills is flagged', () => {
  const v = violation("import api from '@actual-app/api';\nimport './node-polyfills.js';\n");
  assert.match(v || '', /wrong order/);
});

check('POSITIVE: a dynamic-only importer with a static actual-adapter import is allowed', () => {
  const v = violation("import adapter from '../lib/actual-adapter.js';\nconst a = await import('@actual-app/api');\n");
  assert.strictEqual(v, null);
});

check('POSITIVE: a comment-only mention is not treated as an import', () => {
  const v = violation("// @actual-app/api is a singleton module\nimport { z } from 'zod';\n");
  assert.strictEqual(v, null);
});

console.log(`\n[node-polyfill-order] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
