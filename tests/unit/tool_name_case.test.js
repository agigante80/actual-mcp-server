// tests/unit/tool_name_case.test.js
//
// #652: tool names are actual_<domain>_<action> in lower snake_case, never camelCase.
// The six camelCase budget tools were renamed; this guard keeps a new one from appearing.
// Old names live only in src/lib/tool-aliases.ts, which this guard does not read.
//
// Run: node tests/unit/tool_name_case.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

/** Pure: the names that break the snake_case rule. */
function badNames(names) {
  return names.filter((n) => !/^actual(_[a-z0-9]+)+$/.test(n));
}

console.log('\n[#652] tool name case');

const src = readFileSync(join(ROOT, 'src/actualToolsManager.ts'), 'utf8');
const list = src.slice(src.indexOf('const IMPLEMENTED_TOOLS'), src.indexOf('];'));
const implemented = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

check('IMPLEMENTED_TOOLS was found', () => {
  assert.ok(implemented.length > 50, `only ${implemented.length} names parsed`);
});

check('every IMPLEMENTED_TOOLS name is lower snake_case', () => {
  assert.deepStrictEqual(badNames(implemented), []);
});

check('NEGATIVE: a camelCase name is reported', () => {
  assert.deepStrictEqual(badNames(['actual_accounts_list', 'actual_x_getThing']), ['actual_x_getThing']);
});

check('NEGATIVE: a name without the actual_ prefix or with a double underscore is reported', () => {
  assert.deepStrictEqual(badNames(['accounts_list', 'actual__x', 'actual_x_']), ['accounts_list', 'actual__x', 'actual_x_']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
