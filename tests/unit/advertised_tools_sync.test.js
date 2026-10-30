// tests/unit/advertised_tools_sync.test.js
//
// #234: every tool NAME advertised in README.md must resolve to a real entry in
// IMPLEMENTED_TOOLS (src/actualToolsManager.ts). This is the FORWARD-direction
// advertised-surface guard: it catches the "documented-but-missing" / renamed-tool
// class (the #128 phantom-feature failure) that a count guard passes.
//
// #339 ADDS THE REVERSE DIRECTION, and deliberately reverses an earlier decision.
// This file used to say the reverse was "intentionally NOT asserted: the README tool
// table is curated, not exhaustive". That rationale stopped being true: the README
// organised tools into `### Domain (N)` sections whose counts were presented as a
// complete accounting of the surface. A curated subset cannot claim a total.
//
// Leaving only the forward check cost exactly what you would expect. By v0.10.0 the
// README was missing SIX tools, including the entire Schedules domain (4 tools), and
// the section counts summed to 68 against a canonical 74. Both drifted together and
// silently, because nothing looked in that direction. So this file now asserts:
//
//   1. forward:  every name advertised in README.md or docs/reference/tools.md is
//                registered (the #234 guard)
//   2. reverse:  every registered tool is documented in docs/reference/tools.md
//                (#339; the catalogue moved there from README.md in #607)
//   3. (retired by #603) the `### Domain (N)` heading sum: the headings carry no number
//      any more, and the toolset sizes are generated from the registry (scripts/docs/tools.mjs)
//
// Each has a NEGATIVE fixture, because an assertion of the form "this set is empty"
// passes just as happily when the extractor is broken and the set is empty for the
// wrong reason. Mirrors compose_profile_sync.test.js.
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
  // The repo ships 74 tools; the extractor must capture them all (including the
  // camelCase budgets tools), so a loose floor cannot mask a partial parse.
  assert.ok(registry.size >= 74, `expected >= 74 registered tools, got ${registry.size}`);
});

// #607: the per-domain catalogue moved from README.md to docs/reference/tools.md. The
// forward check scans BOTH, because the README still names tools in prose (the chat
// preset list, the read-only examples) and a renamed tool there is the same defect.
const ADVERTISING_FILES = ['README.md', 'docs/reference/tools.md'];
for (const file of ADVERTISING_FILES) {
  check(`every actual_<domain>_<action> name advertised in ${file} is in IMPLEMENTED_TOOLS`, () => {
    const advertised = [...new Set(advertisedNames(read(file)))];
    assert.ok(advertised.length > 0, `no advertised tool names found in ${file} (extractor broke?)`);
    const missing = advertised.filter((n) => !registry.has(n)).sort();
    assert.strictEqual(missing.length, 0, `${file} advertises tool(s) not in IMPLEMENTED_TOOLS: ${missing.join(', ')}`);
  });
}

// NEGATIVE: prove the guard catches a documented-but-missing / renamed tool.
check('NEGATIVE: an advertised phantom tool is detected by the same extractor + set-difference', () => {
  const fakeReadme = 'See `actual_accounts_list` and the new `actual_phantom_tool` for details.';
  const advertised = [...new Set(advertisedNames(fakeReadme))];
  const missing = advertised.filter((n) => !registry.has(n)).sort();
  assert.deepStrictEqual(missing, ['actual_phantom_tool'], 'guard must flag exactly the phantom tool');
});

// ---------------------------------------------------------------------------
// #339: REVERSE direction. Every registered tool must be documented.
// ---------------------------------------------------------------------------

// The reverse check reads the RAW text, not the backtick-delimited names, because a
// tool may legitimately be documented in a table cell or prose without backticks.
// Requiring a backtick here would produce false failures and get the guard weakened.
const undocumented = (readmeText, names) => [...names].filter((n) => !readmeText.includes(n)).sort();

// #607: the reverse check reads the tools reference page, which now owns the catalogue.
check('every tool in IMPLEMENTED_TOOLS appears in docs/reference/tools.md (#339, #607)', () => {
  const missing = undocumented(read('docs/reference/tools.md'), registry);
  assert.strictEqual(
    missing.length,
    0,
    `docs/reference/tools.md does not document ${missing.length} registered tool(s): ${missing.join(', ')}. ` +
      'Add them to the tables in docs/reference/tools.md.',
  );
});

// #607 NEGATIVE on the REAL page: removing one tool from the actual reference text must
// flag exactly that tool, which proves the reverse check reads the page it claims to.
check('NEGATIVE: docs/reference/tools.md with actual_accounts_list removed flags exactly that tool (#607)', () => {
  const text = read('docs/reference/tools.md').split('actual_accounts_list').join('');
  assert.deepStrictEqual(undocumented(text, registry), ['actual_accounts_list']);
});

check('NEGATIVE: a registered-but-undocumented tool is detected', () => {
  // A README that documents only one tool must flag every other registered one.
  const missing = undocumented('Only `actual_accounts_list` is documented here.', registry);
  assert.ok(missing.length > 0, 'guard must flag undocumented tools');
  assert.ok(!missing.includes('actual_accounts_list'), 'the one documented tool must NOT be flagged');
  assert.ok(missing.includes('actual_schedules_get'), 'a genuinely absent tool must be flagged');
});

console.log(`\n[advertised-tools-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
