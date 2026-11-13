// tests/unit/new_tool_completeness.test.js
//
// #429 follow-up: adding a tool touches a dozen files, and docs/development/new-tool-checklist.md
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
// #681: the e2e, manual-integration and llm-prompt surfaces are no longer asked about the 85
// legacy names. The suites call the COMPACT tools (15 of them), so those three surfaces are
// checked per (compact tool, action) pair: every pair in COMPACT_TOOLS must be called by name
// with its selector value in the spec, in a manual module, and described on one line of a
// prompt. The two session tools have no compact tool and keep a legacy-name check. The
// tool-file, index-export and tools-reference surfaces stay per legacy tool.
//
// Run: node tests/unit/new_tool_completeness.test.js
// (needs `npm run build` first: the compact registry is read from dist/)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const { COMPACT_TOOLS, OUT_OF_SCOPE } = await import(pathToFileURL(join(ROOT, 'dist/src/compact/registry.js')).href);

// The session tools manage the connection pool, not budget data, and no compact tool wraps them.
// They are the only legacy names the e2e, manual and prompt surfaces still have to carry.

// One entry per (compact tool, action). A tool with `selector: null` has one entry, its default.
const PAIRS = [];
for (const spec of COMPACT_TOOLS) {
  const selector = spec.selector === undefined ? 'action' : spec.selector;
  for (const action of spec.actions.keys()) {
    PAIRS.push({ tool: spec.name, selector, action, isDefault: action === spec.defaultAction });
  }
}
const pairLabel = (pr) => `${pr.tool}.${pr.action}`;

const TOOLS = (read('src/actualToolsManager.ts').match(/^\s*'(actual_[A-Za-z0-9_]+)'/gm) || [])
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
const manualModules = () => readdirSync(join(ROOT, 'tests/manual/tests'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(ROOT, 'tests/manual/tests', f), 'utf8'));
const promptFiles = () => readdirSync(join(ROOT, 'tests/manual-prompt'))
  .filter((f) => f.startsWith('prompt-'))
  .map((f) => readFileSync(join(ROOT, 'tests/manual-prompt', f), 'utf8'));
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A call site: the tool name as a string literal, then an object literal holding the selector.
// A call that omits the selector counts for the tool's default action; a tool with no selector
// needs the name only.
const callsPair = (text, pr) => {
  const tool = escapeRe(pr.tool);
  if (pr.selector === null) return new RegExp(`['"]${tool}['"]`).test(text);
  const sel = escapeRe(pr.selector);
  const explicit = new RegExp(`['"]${tool}['"],\\s*\\{[^}]*\\b${sel}:\\s*['"]${escapeRe(pr.action)}['"]`);
  if (explicit.test(text)) return true;
  if (!pr.isDefault) return false;
  return new RegExp(`['"]${tool}['"]\\s*(?:\\)|,\\s*\\{(?:(?!\\b${sel}\\s*:)[^}])*\\})`).test(text);
};
// A prompt line: the tool name and the action word on one line (the default action needs the name).
const describesPair = (text, pr) => text.split('\n').some((line) => {
  if (!new RegExp(`\\b${escapeRe(pr.tool)}\\b`).test(line)) return false;
  return pr.isDefault || new RegExp(`\\b${escapeRe(pr.action)}\\b`).test(line);
});

/** The per-pair surfaces: each pair of each compact tool must reach every one. */
const PAIR_SURFACES = [
  {
    id: 'e2e',
    what: 'called in tests/e2e/docker-all-tools.e2e.spec.ts or compact-surface.e2e.spec.ts',
    find: (pr) => ['tests/e2e/docker-all-tools.e2e.spec.ts', 'tests/e2e/compact-surface.e2e.spec.ts']
      .some((f) => callsPair(read(f) || '', pr)),
  },
  {
    id: 'manual-integration',
    what: 'called in a tests/manual/tests/*.js module',
    find: (pr) => manualModules().some((text) => callsPair(text, pr)),
  },
  {
    id: 'llm-prompt',
    what: 'described on one line of a tests/manual-prompt/prompt-*.txt file',
    find: (pr) => promptFiles().some((text) => describesPair(text, pr)),
  },
];

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
    id: 'tools-reference',
    what: 'listed in docs/reference/tools.md',
    find: (t) => (read('docs/reference/tools.md') || '').includes(t),
  },
  {
    id: 'e2e',
    what: 'the session tools are exercised in tests/e2e/docker-all-tools.e2e.spec.ts',
    find: (t) => (read('tests/e2e/docker-all-tools.e2e.spec.ts') || '').includes(t),
    only: OUT_OF_SCOPE,
  },
  {
    id: 'manual-integration',
    what: 'the session tools are exercised in a tests/manual/tests/*.js module',
    find: (t) => manualModules().some((text) => text.includes(t)),
    only: OUT_OF_SCOPE,
  },
  {
    id: 'llm-prompt',
    what: 'the session tools are described in a tests/manual-prompt/prompt-*.txt file',
    find: (t) => promptFiles().some((text) => text.includes(t)),
    only: OUT_OF_SCOPE,
  },
];

/**
 * Documented exceptions. Key is `<surface-id>:<tool>`, value is the REASON.
 * A reason is mandatory, and every entry is checked for staleness below.
 */
const EXCEPTIONS = {
  // EMPTY, and that is the enforcing state. #451 closed the last of the pre-existing debt
  // (payees_common_list and the tags family had no live-server block; nine tools had no prompt
  // scenario). An empty map means a new tool cannot reach every other surface and quietly skip
  // the manual and model-driven layers.
  //
  // Adding an entry is allowed but it is a DECISION, not a formality: give the reason and a
  // ticket, the way the entries this replaced named #451. The staleness check below fails if an
  // entry outlives its gap, so the list cannot decay into a blanket opt-out.
};


console.log('\n[new-tool-completeness] every registered tool reaches every required surface');

check('IMPLEMENTED_TOOLS parsed', () => {
  if (TOOLS.length < 50) fail(`expected the full tool list, parsed ${TOOLS.length}`);
});

for (const surface of SURFACES) {
  check(`every tool: ${surface.what}`, () => {
    const scope = surface.only ? TOOLS.filter((t) => surface.only.includes(t)) : TOOLS;
    if (surface.only && scope.length !== surface.only.length) fail('an OUT_OF_SCOPE tool is no longer registered');
    const missing = scope.filter((t) => !surface.find(t) && !(`${surface.id}:${t}` in EXCEPTIONS));
    if (missing.length) {
      fail(
        `${missing.length} tool(s) missing from this surface:\n      ` +
        missing.join('\n      ') +
        `\n    Fix the file, or add "${surface.id}:<tool>": "<reason>" to EXCEPTIONS in this test.` +
        `\n    See docs/development/new-tool-checklist.md.`,
      );
    }
  });
}

check('COMPACT_TOOLS parsed into (tool, action) pairs', () => {
  if (PAIRS.length < 60) fail(`expected the full compact registry, parsed ${PAIRS.length} pairs`);
});

for (const surface of PAIR_SURFACES) {
  check(`every compact (tool, action) pair: ${surface.what}`, () => {
    const missing = PAIRS.filter((pr) => !surface.find(pr) && !(`${surface.id}:${pairLabel(pr)}` in EXCEPTIONS));
    if (missing.length) {
      fail(
        `${missing.length} pair(s) missing from surface "${surface.id}":\n      ` +
        missing.map((pr) => `${pairLabel(pr)} (${surface.id})`).join('\n      ') +
        `\n    Add a call naming the tool and its selector value, or "${surface.id}:<tool>.<action>": "<reason>" to EXCEPTIONS.` +
        `\n    See docs/development/new-tool-checklist.md.`,
      );
    }
  });
}

// #451: the prompt files carry hand-maintained tally blocks, and they had silently drifted.
// #429 added Phase 2b (account groups, 4 tools) and never touched the summary, so the block
// omitted the phase entirely and the printed total was 39 for phases summing to 43. A human
// pasting the prompt into a model would then report a total that cannot be reconciled with the
// phases above it, which is exactly the kind of number nobody rechecks.
//
// This asserts only INTERNAL CONSISTENCY: the printed total equals the sum of the phase lines
// shown directly above it. It deliberately does NOT try to count tools in the prompt bodies. A
// phase line is a nominal label (some tools appear in two phases, some are deferred to the
// cleanup phase), so a count-derived assertion would be wrong in a way that is hard to argue
// with and would be silenced rather than fixed.
check('every prompt tally block adds up', () => {
  const problems = [];
  for (const file of readdirSync(join(ROOT, 'tests/manual-prompt')).filter((f) => f.startsWith('prompt-'))) {
    const text = readFileSync(join(ROOT, 'tests/manual-prompt', file), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const total = /^\s*Total(?: Tools Tested)?:\s*X\s*\/\s*(\d+)\s*$/.exec(lines[i]);
      if (!total) continue;
      // Walk BACKWARDS collecting `... X / N` phase lines until the block ends.
      let sum = 0;
      let counted = 0;
      for (let j = i - 1; j >= 0; j--) {
        const line = lines[j];
        if (/^\s*(={3,}|-{3,}|─{3,})\s*$/.test(line)) continue;       // a rule inside the block
        const phase = /^\s*Phase\s+\S+.*?X\s*\/\s*(\d+)\s*$/.exec(line);
        if (phase) { sum += Number(phase[1]); counted++; continue; }
        if (/^\s*(Phase\s+\d+\S*\s+\w.*Skipped|PROMPT\s|\s*$)/.test(line)) continue;  // headings, blanks, skips
        break;
      }
      if (counted === 0) continue;   // not a tally block
      if (sum !== Number(total[1])) {
        problems.push(`${file}: total says ${total[1]} but the ${counted} phase lines above it sum to ${sum}`);
      }
    }
  }
  if (problems.length) fail(problems.join('\n      '));
});

// The prompt README carries the same tally as a MARKDOWN TABLE plus a stated grand total, and
// the check above could not see it: it filters to files starting with `prompt-`. Review of #451
// caught the guard passing over the one file that ticket had left wrong (the table summed to 82
// while the total below it still said 68). A guard that misses the document it was written for
// is worse than none, so the README is now checked on its own terms.
// #681: it is compared only against the sum of its own table rows. The prompts now count
// compact (tool, action) scenarios, not the 85 legacy tools, so no registered count applies.
check('the prompt README grand total matches its own table', () => {
  const text = read('tests/manual-prompt/README.md') || '';
  const stated = /\*\*Total:\s*(\d+)\s*tools across 3 prompts\*\*/.exec(text);
  if (!stated) return fail('the README no longer states a grand total in the expected form');
  // Rows look like: | 6b | Prompt 2 | 4 | Schedule CRUD |
  let sum = 0;
  let rows = 0;
  for (const line of text.split('\n')) {
    const row = /^\|\s*[0-9]+[a-z]?\s*\|\s*Prompt\s+\d\s*\|\s*(\d*)\s*\|/.exec(line);
    if (!row) continue;
    rows++;
    if (row[1]) sum += Number(row[1]);   // blank cells (cleanup, optional phases) count as zero
  }
  if (rows < 10) return fail(`only ${rows} phase rows parsed from the README table; the format changed`);
  if (sum !== Number(stated[1])) {
    fail(`README says "${stated[1]} tools across 3 prompts" but its ${rows} table rows sum to ${sum}`);
  }
});

check('no EXCEPTION is stale (a silenced entry that no longer needs silencing)', () => {
  // Without this the list decays into a blanket opt-out: an entry stays after its tool is
  // documented, and the next person copies it. Same reasoning as the tool-count guard's
  // "a stale entry licenses a future field".
  const stale = [];
  for (const key of Object.keys(EXCEPTIONS)) {
    const [surfaceId, tool] = key.split(':');
    const pair = PAIRS.find((pr) => pairLabel(pr) === tool);
    if (pair) {
      const ps = PAIR_SURFACES.find((x) => x.id === surfaceId);
      if (!ps) stale.push(`${key} (no such surface "${surfaceId}")`);
      else if (ps.find(pair)) stale.push(`${key} (the pair IS present now; drop the exception)`);
      continue;
    }
    const surface = SURFACES.find((x) => x.id === surfaceId);
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

// #537: the project forbids the em and en dash characters in every file it writes, and these
// prompts are pasted into a model verbatim, so a dash here is copied into its report as well.
// The box-drawing rule character (U+2500) used by the tally blocks is a different character
// and stays allowed.
const DASHES = /[\u2013\u2014]/;
check('manual-prompt files contain no em or en dash', () => {
  const dir = join(ROOT, 'tests/manual-prompt');
  const files = readdirSync(dir).filter((f) => f.startsWith('prompt-') || f === 'README.md');
  if (files.length < 4) fail(`expected the three prompts and the README, found ${files.join(', ')}`);
  const hits = [];
  for (const file of files) {
    readFileSync(join(dir, file), 'utf8').split('\n').forEach((line, i) => {
      if (DASHES.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  if (DASHES.test('a \u2014 b') === false) fail('the dash pattern cannot match');
  if (hits.length) fail(`${hits.length} line(s) with an em or en dash: ${hits.slice(0, 10).join(', ')}`);
});

check('SELF-CHECK: the guard can actually fail', () => {
  // A completeness guard that cannot fail is worse than none, because it certifies. Prove
  // each surface rejects a tool that is genuinely absent everywhere.
  const ghost = 'actual_this_tool_does_not_exist_xyz';
  for (const surface of SURFACES) {
    if (surface.find(ghost)) fail(`surface "${surface.id}" claims a nonexistent tool is present`);
  }
  const ghostPair = { tool: 'this_tool_does_not_exist_xyz', selector: 'action', action: 'create', isDefault: false };
  for (const surface of PAIR_SURFACES) {
    if (surface.find(ghostPair)) fail(`pair surface "${surface.id}" claims a nonexistent pair is present`);
  }
  // A real tool with an action nobody calls must also be rejected: the action is part of the key.
  const wrongAction = { tool: 'manage_tags', selector: 'action', action: 'no_such_action_xyz', isDefault: false };
  for (const surface of PAIR_SURFACES) {
    if (surface.find(wrongAction)) fail(`pair surface "${surface.id}" accepts a made-up action`);
  }
});

console.log(`\n[new-tool-completeness] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
