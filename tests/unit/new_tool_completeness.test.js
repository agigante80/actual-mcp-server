// tests/unit/new_tool_completeness.test.js
//
// #429 follow-up: adding a tool touches a dozen files, and docs/NEW_TOOL_CHECKLIST.md
// lists them, but nothing ENFORCED the list. The existing guards each cover one edge:
//   - verify-tools           : the tool is registered
//   - advertised_tools_sync  : README -> IMPLEMENTED_TOOLS (a tool named in the README exists)
//   - tool_annotations       : every tool is classified
//   - tool-count             : the TOTAL literals agree
// The missing direction is IMPLEMENTED_TOOLS -> everywhere else: a tool that is registered
// but never documented, never smoke-tested and never exercised end to end passes every one
// of those and ships invisible.
//
// This closes that direction. For EVERY tool it asserts presence in each required surface,
// with a documented exception list. An exception must name a reason, and a STALE exception
// (one whose tool now appears anyway, or whose tool no longer exists) is itself a failure,
// so the list cannot rot into a blanket opt-out.
//
// Run: node tests/unit/new_tool_completeness.test.js

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
};
const fail = (msg) => { throw new Error(msg); };

const TOOLS = (read('src/actualToolsManager.ts').match(/^\s*'(actual_[a-z0-9_]+)'/gm) || [])
  .map((l) => l.trim().replace(/'/g, '').replace(/,$/, ''));

/**
 * The surfaces a new tool must reach. `find` returns true when the tool is present.
 * Kept deliberately SHALLOW (substring of the tool name): this guard answers "did you
 * remember this file at all", not "is the content good". Depth here would make it
 * brittle and would duplicate the checks that already exist elsewhere.
 */
// NOTE on a surface deliberately NOT checked: tests/unit/generated_tools.smoke.test.js.
// It ITERATES every registered tool automatically and only needs a hand-written input
// example for tools with required fields, keyed by SHORT name. A presence check there
// reported 70 of 81 tools "missing", all false. A guard that cannot distinguish a real
// omission from a tool that legitimately needs no entry is worse than no guard, so the
// smoke test is left to its own iteration.
const SURFACES = [
  {
    id: 'tool-file',
    what: 'src/tools/<name>.ts exists (the file name must match the tool name)',
    find: (t) => existsSync(join(ROOT, 'src/tools', `${t.replace(/^actual_/, '')}.ts`)),
  },
  {
    id: 'index-export',
    what: 'exported from src/tools/index.ts',
    find: (t) => (read('src/tools/index.ts') || '').includes(`as ${t.replace(/^actual_/, '')} `),
  },
  {
    id: 'readme',
    what: 'listed in the README Available Tools table',
    find: (t) => (read('README.md') || '').includes(t),
  },
  {
    id: 'e2e',
    what: 'exercised in tests/e2e/docker-all-tools.e2e.spec.ts',
    find: (t) => (read('tests/e2e/docker-all-tools.e2e.spec.ts') || '').includes(t),
  },
  {
    id: 'manual-integration',
    what: 'exercised in a tests/manual/tests/*.js module',
    find: (t) => readdirSync(join(ROOT, 'tests/manual/tests'))
      .filter((f) => f.endsWith('.js'))
      .some((f) => readFileSync(join(ROOT, 'tests/manual/tests', f), 'utf8').includes(t)),
  },
  {
    id: 'llm-prompt',
    what: 'described in a tests/manual-prompt/prompt-*.txt file',
    find: (t) => readdirSync(join(ROOT, 'tests/manual-prompt'))
      .filter((f) => f.startsWith('prompt-'))
      .some((f) => readFileSync(join(ROOT, 'tests/manual-prompt', f), 'utf8').includes(t)),
  },
];

/**
 * Documented exceptions. Key is `<surface-id>:<tool>`, value is the REASON.
 * A reason is mandatory, and every entry is checked for staleness below.
 */
const EXCEPTIONS = {
  // PRE-EXISTING debt, tracked as #451, NOT a licence for new tools. Every entry here was
  // red the first time this guard ran, before the account-group work that introduced it.
  // The staleness check below fails if any of these is left after its gap is closed, so
  // the list cannot quietly outlive the ticket.
  //
  // These nine reach the unit and E2E layers; what they miss is the LIVE-server manual
  // integration modules and the model-driven prompt files.
  'manual-integration:actual_payees_common_list': 'pre-existing gap, tracked in #451',
  'manual-integration:actual_tags_list': 'pre-existing gap, tracked in #451',
  'manual-integration:actual_tags_create': 'pre-existing gap, tracked in #451',
  'manual-integration:actual_tags_update': 'pre-existing gap, tracked in #451',
  'manual-integration:actual_tags_delete': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_account_flow_summary': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_recurring_expenses_summary': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_transactions_aggregate': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_transfers_create': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_payees_common_list': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_tags_list': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_tags_create': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_tags_update': 'pre-existing gap, tracked in #451',
  'llm-prompt:actual_tags_delete': 'pre-existing gap, tracked in #451',
};

console.log('\n[new-tool-completeness] every registered tool reaches every required surface');

check('IMPLEMENTED_TOOLS parsed', () => {
  if (TOOLS.length < 50) fail(`expected the full tool list, parsed ${TOOLS.length}`);
});

for (const surface of SURFACES) {
  check(`every tool: ${surface.what}`, () => {
    const missing = TOOLS.filter((t) => !surface.find(t) && !(`${surface.id}:${t}` in EXCEPTIONS));
    if (missing.length) {
      fail(
        `${missing.length} tool(s) missing from this surface:\n      ` +
        missing.join('\n      ') +
        `\n    Fix the file, or add "${surface.id}:<tool>": "<reason>" to EXCEPTIONS in this test.` +
        `\n    See docs/NEW_TOOL_CHECKLIST.md.`,
      );
    }
  });
}

check('no EXCEPTION is stale (a silenced entry that no longer needs silencing)', () => {
  // Without this the list decays into a blanket opt-out: an entry stays after its tool is
  // documented, and the next person copies it. Same reasoning as the tool-count guard's
  // "a stale entry licenses a future field".
  const stale = [];
  for (const key of Object.keys(EXCEPTIONS)) {
    const [surfaceId, tool] = key.split(':');
    const surface = SURFACES.find((s) => s.id === surfaceId);
    if (!surface) { stale.push(`${key} (no such surface "${surfaceId}")`); continue; }
    if (!TOOLS.includes(tool)) { stale.push(`${key} (tool no longer registered)`); continue; }
    if (surface.find(tool)) stale.push(`${key} (the tool IS present now; drop the exception)`);
  }
  if (stale.length) fail(`stale exceptions:\n      ${stale.join('\n      ')}`);
});

check('every EXCEPTION carries a reason', () => {
  const empty = Object.entries(EXCEPTIONS).filter(([, why]) => !why || why.trim().length < 15);
  if (empty.length) fail(`these need a real reason: ${empty.map(([k]) => k).join(', ')}`);
});

check('SELF-CHECK: the guard can actually fail', () => {
  // A completeness guard that cannot fail is worse than none, because it certifies. Prove
  // each surface rejects a tool that is genuinely absent everywhere.
  const ghost = 'actual_this_tool_does_not_exist_xyz';
  for (const surface of SURFACES) {
    if (surface.find(ghost)) fail(`surface "${surface.id}" claims a nonexistent tool is present`);
  }
});

console.log(`\n[new-tool-completeness] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
