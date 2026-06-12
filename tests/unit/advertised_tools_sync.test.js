// tests/unit/advertised_tools_sync.test.js
//
// #234: every tool NAME advertised in README.md must resolve to a real entry in
// IMPLEMENTED_TOOLS (src/actualToolsManager.ts). This is the FORWARD-direction
// advertised-surface guard: it catches the "documented-but-missing" / renamed-tool
// class (the #128 phantom-feature failure) that a count guard passes. The REVERSE
// direction (every registered tool is documented) is intentionally NOT asserted: the
// README tool table is curated, not exhaustive. Mirrors compose_profile_sync.test.js.
//
// Run: node tests/unit/advertised_tools_sync.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Backtick-delimited tool-name tokens: at least two underscores so an env-var-style
// token like `actual_password` (one underscore) cannot match. Case-insensitive segments
// because some tool names are camelCase (e.g. actual_budgets_setAmount, _getMonth).
const ADVERTISED_RE = /`(actual_[a-zA-Z0-9]+_[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)`/g;
const advertisedNames = (text) => [...text.matchAll(ADVERTISED_RE)].map((m) => m[1]);

// IMPLEMENTED_TOOLS is a non-exported const; read the registry by extracting the
// quoted actual_* literals inside the IMPLEMENTED_TOOLS array in the source. Anchor on
// `= [` (not the first `[`) so a future `const IMPLEMENTED_TOOLS: string[] = [` does not
// truncate the captured block. Names are matched case-insensitively (camelCase tools).
function registryNames() {
  const src = read('src/actualToolsManager.ts');
  const block = src.match(/IMPLEMENTED_TOOLS[^=]*=\s*\[([\s\S]*?)\n\];/);
  assert(block, 'could not locate the IMPLEMENTED_TOOLS array in src/actualToolsManager.ts');
  return new Set([...block[1].matchAll(/'(actual_[a-zA-Z0-9_]+)'/g)].map((m) => m[1]));
}

console.log('\n[advertised-tools-sync]');

const registry = registryNames();

check('registry parsed completely (case-insensitive, no under-count)', () => {
  // The repo ships 71 tools; the extractor must capture them all (including the
  // camelCase budgets tools), so a loose floor cannot mask a partial parse.
  assert.ok(registry.size >= 71, `expected >= 71 registered tools, got ${registry.size}`);
});

check('every actual_<domain>_<action> name advertised in README is in IMPLEMENTED_TOOLS', () => {
  const advertised = [...new Set(advertisedNames(read('README.md')))];
  assert.ok(advertised.length > 0, 'no advertised tool names found in README (extractor broke?)');
  const missing = advertised.filter((n) => !registry.has(n)).sort();
  assert.strictEqual(missing.length, 0, `README advertises tool(s) not in IMPLEMENTED_TOOLS: ${missing.join(', ')}`);
});

// NEGATIVE: prove the guard catches a documented-but-missing / renamed tool.
check('NEGATIVE: an advertised phantom tool is detected by the same extractor + set-difference', () => {
  const fakeReadme = 'See `actual_accounts_list` and the new `actual_phantom_tool` for details.';
  const advertised = [...new Set(advertisedNames(fakeReadme))];
  const missing = advertised.filter((n) => !registry.has(n)).sort();
  assert.deepStrictEqual(missing, ['actual_phantom_tool'], 'guard must flag exactly the phantom tool');
});

console.log(`\n[advertised-tools-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
