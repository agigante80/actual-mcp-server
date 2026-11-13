// tests/unit/e2e_uses_compact_names.test.js
//
// #681: the suites that drive the server (the Playwright specs, the live-server manual modules,
// the stdio smoke script and the model-driven prompts) call the COMPACT tools, because that is
// the surface a client sees by default after #680. A legacy `actual_*` name in one of them is
// either a leftover from before the migration or a call that only works on the legacy and all
// surfaces, and on the compact surface it is refused. Without a guard the legacy names creep
// back in one convenient call at a time and the compact surface loses its coverage unseen.
//
// The legacy name set is IMPLEMENTED_TOOLS plus the keys of the deprecated alias map. A legacy
// name is allowed in exactly these places:
//   (i)   LEGACY_SMOKE names inside the `legacy smoke (MCP_TOOL_SURFACE=all)` describe block of
//         tests/e2e/docker-all-tools.e2e.spec.ts (one read-only row per legacy family),
//   (ii)  the two session tools (they have no compact tool) in specs, manual modules and the
//         session block of prompt-3-advanced.txt between its two markers,
//   (iii) actual_accounts_list in compact-surface.e2e.spec.ts (the refusal row: a legacy call
//         must be refused on the compact surface),
//   (iv)  the prompt-3 session block (see (ii)),
//   (v)   the deprecated alias row (ALIAS_ROWS: a key of the alias map, kept until the alias
//         is removed after 2027-02-01).
//
// Run: node tests/unit/e2e_uses_compact_names.test.js

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
};
const fail = (msg) => { throw new Error(msg); };

const IMPLEMENTED_TOOLS = (read('src/actualToolsManager.ts').match(/^\s*'(actual_[A-Za-z0-9_]+)'/gm) || [])
  .map((l) => l.trim().replace(/'/g, '').replace(/,$/, ''));
const ALIAS_KEYS = (read('src/lib/tool-aliases.ts').match(/^\s*\['(actual_[A-Za-z0-9_]+)',/gm) || [])
  .map((l) => /'(actual_[A-Za-z0-9_]+)'/.exec(l)[1]);
const LEGACY_NAMES = new Set([...IMPLEMENTED_TOOLS, ...ALIAS_KEYS]);

/** One read-only row per legacy family, called in the legacy smoke describe block. */
const LEGACY_SMOKE = [
  'actual_accounts_list',
  'actual_transactions_search_by_month',
  'actual_categories_get',
  'actual_payees_get',
  'actual_rules_get',
  'actual_schedules_get',
  'actual_budgets_get_months',
  'actual_budgets_list_available',
  'actual_tags_list',
  'actual_notes_get',
  'actual_entities_search',
  'actual_transactions_summary_by_category',
  'actual_query_run',
  'actual_server_get_version',
];
const SESSION_TOOLS = ['actual_session_list', 'actual_session_close'];
/** Deprecated alias rows: each key must be a key of the alias map. */
const ALIAS_ROWS = ['actual_budgets_getMonths'];
/** The refusal row of the compact leg calls this legacy tool on purpose. */
const REFUSAL_ROW = { file: 'tests/e2e/compact-surface.e2e.spec.ts', name: 'actual_accounts_list' };

const SMOKE_FILE = 'tests/e2e/docker-all-tools.e2e.spec.ts';
const SMOKE_START = "test.describe('legacy smoke (MCP_TOOL_SURFACE=all)'";
const PROMPT3 = 'tests/manual-prompt/prompt-3-advanced.txt';
const SESSION_OPEN = '[legacy or all surface only: skip on compact]';
const SESSION_CLOSE = '[end legacy or all surface only]';

/**
 * Files that call legacy names on purpose and are NOT scanned. Each entry names the reason, and
 * the check below fails when a listed file no longer exists or no longer holds a legacy name.
 */
const LEGACY_HELPERS = {
  'tests/e2e/fixtures.ts': 'the self-provisioning fixtures create their entities through the legacy tools; they run on the all surface and are not a client-facing call',
};

const scannedFiles = () => {
  const files = [
    'tests/e2e/docker-all-tools.e2e.spec.ts',
    'tests/e2e/docker.e2e.spec.ts',
    'tests/e2e/mcp-client.playwright.spec.ts',
    'tests/e2e/compact-surface.e2e.spec.ts',
    'scripts/stdio-smoke.mjs',
  ];
  for (const f of readdirSync(join(ROOT, 'tests/manual/tests')).filter((x) => x.endsWith('.js')).sort()) {
    files.push(`tests/manual/tests/${f}`);
  }
  for (const f of readdirSync(join(ROOT, 'tests/manual-prompt')).filter((x) => /^prompt-.*\.txt$/.test(x)).sort()) {
    files.push(`tests/manual-prompt/${f}`);
  }
  return files;
};

/** 1-based line range [from, to] of the legacy smoke describe block, or null. */
const smokeRange = (text) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(SMOKE_START));
  if (start < 0) return null;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '});') { end = i; break; }
  }
  return end < 0 ? null : [start + 1, end + 1];
};

/** The legacy-name tokens of a text that are not allowed, as `file:line: message` strings. */
function legacyProblems(file, text) {
  const problems = [];
  const smoke = file === SMOKE_FILE ? smokeRange(text) : null;
  const lines = text.split('\n');
  let inSessionBlock = false;
  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (file === PROMPT3) {
      if (line.includes(SESSION_OPEN)) inSessionBlock = true;
      else if (line.includes(SESSION_CLOSE)) inSessionBlock = false;
    }
    for (const m of line.matchAll(/[A-Za-z0-9_]+/g)) {
      const name = m[0];
      if (!name.startsWith('actual_') || !LEGACY_NAMES.has(name)) continue;
      const isPrompt = file.endsWith('.txt');
      if (SESSION_TOOLS.includes(name) && (!isPrompt || inSessionBlock)) continue;
      if (smoke && n >= smoke[0] && n <= smoke[1] && LEGACY_SMOKE.includes(name)) continue;
      if (file === REFUSAL_ROW.file && name === REFUSAL_ROW.name) continue;
      if (file === SMOKE_FILE && ALIAS_ROWS.includes(name)) continue;
      problems.push(`${file}:${n}: legacy tool name ${name} outside LEGACY_SMOKE`);
    }
  });
  return problems;
}

console.log('\n[e2e-uses-compact-names] the suites call compact tools, with a bounded legacy allowance');

check('the legacy name set parsed', () => {
  if (IMPLEMENTED_TOOLS.length < 50) fail(`parsed ${IMPLEMENTED_TOOLS.length} IMPLEMENTED_TOOLS`);
  if (ALIAS_KEYS.length < 1) fail('parsed no deprecated alias keys');
});

check('no scanned file uses a legacy tool name outside its allowance', () => {
  const problems = [];
  for (const file of scannedFiles()) {
    if (!existsSync(join(ROOT, file))) fail(`${file} is scanned but does not exist`);
    problems.push(...legacyProblems(file, read(file)));
  }
  if (problems.length) fail(`${problems.length} problem(s):\n      ${problems.join('\n      ')}`);
});

check('every LEGACY_SMOKE entry is a registered tool and is called in the smoke block', () => {
  const text = read(SMOKE_FILE);
  const range = smokeRange(text);
  if (!range) return fail(`${SMOKE_FILE} has no "${SMOKE_START}" block`);
  const block = text.split('\n').slice(range[0] - 1, range[1]).join('\n');
  const problems = [];
  for (const name of LEGACY_SMOKE) {
    if (!IMPLEMENTED_TOOLS.includes(name)) problems.push(`LEGACY_SMOKE entry ${name} is not in IMPLEMENTED_TOOLS`);
    else if (!new RegExp(`['"]${name}['"]`).test(block)) problems.push(`LEGACY_SMOKE entry ${name} is not called in the smoke block`);
  }
  if (problems.length) fail(problems.join('\n      '));
});

check('every ALIAS_ROWS entry is a key of the deprecated alias map and is used', () => {
  const text = read(SMOKE_FILE);
  const problems = [];
  for (const name of ALIAS_ROWS) {
    if (!ALIAS_KEYS.includes(name)) problems.push(`ALIAS_ROWS entry ${name} is not a key of DEPRECATED_TOOL_ALIASES`);
    else if (!text.includes(`'${name}'`)) problems.push(`ALIAS_ROWS entry ${name} is not called in ${SMOKE_FILE}`);
  }
  if (problems.length) fail(problems.join('\n      '));
});

check('the session tools are still called, and the refusal row still names its tool', () => {
  const spec = read(SMOKE_FILE);
  for (const t of SESSION_TOOLS) if (!spec.includes(`'${t}'`)) fail(`${SMOKE_FILE} no longer calls ${t}; drop it from SESSION_TOOLS`);
  if (!read(REFUSAL_ROW.file).includes(`'${REFUSAL_ROW.name}'`)) fail(`${REFUSAL_ROW.file} no longer calls ${REFUSAL_ROW.name}`);
  const p3 = read(PROMPT3);
  if (!p3.includes(SESSION_OPEN) || !p3.includes(SESSION_CLOSE)) fail(`${PROMPT3} lost its session block markers`);
});

check('every LEGACY_HELPERS file exists, carries a reason, and still holds a legacy name', () => {
  const problems = [];
  for (const [file, why] of Object.entries(LEGACY_HELPERS)) {
    if (!why || why.trim().length < 15) problems.push(`${file}: needs a real reason`);
    if (!existsSync(join(ROOT, file))) { problems.push(`${file}: listed in LEGACY_HELPERS but missing`); continue; }
    const text = read(file);
    if (![...text.matchAll(/[A-Za-z0-9_]+/g)].some((m) => LEGACY_NAMES.has(m[0]))) {
      problems.push(`${file}: holds no legacy name any more; drop it from LEGACY_HELPERS`);
    }
  }
  if (problems.length) fail(problems.join('\n      '));
});

check('SELF-CHECK: the guard can actually fail', () => {
  const stray = legacyProblems('tests/manual/tests/tags.js', "await call('actual_tags_list');\n");
  if (stray.length !== 1 || !/tags\.js:1: legacy tool name actual_tags_list outside LEGACY_SMOKE/.test(stray[0])) {
    fail(`a stray legacy call was not reported exactly once: ${JSON.stringify(stray)}`);
  }
  const compact = legacyProblems('tests/manual/tests/tags.js', "await call('manage_tags', { action: 'list' });\n");
  if (compact.length) fail(`a compact call was reported: ${JSON.stringify(compact)}`);
  const outside = legacyProblems(SMOKE_FILE, "await mcp.call('actual_tags_list');\n");
  if (outside.length !== 1) fail('a smoke name outside the smoke block was not reported');
  const promptOutside = legacyProblems('tests/manual-prompt/prompt-1-smoke.txt', 'actual_session_list\n');
  if (promptOutside.length !== 1) fail('a session tool outside the prompt-3 block was not reported');
});

console.log(`\n[e2e-uses-compact-names] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
