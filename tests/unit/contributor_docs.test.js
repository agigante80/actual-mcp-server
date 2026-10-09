// tests/unit/contributor_docs.test.js
//
// #496: the files an outside contributor (or their coding agent) reads first must not
// send them to commands and paths that do not exist. CONTRIBUTING.md had drifted into
// exactly that state: it named `npm run test:unit`, `npm run lint` and `npm run format`,
// none of which were scripts, and a `test/` tree that had been `tests/` for a long time.
// Nothing looked, so nothing noticed.
//
// Asserted here:
//   1. every `npm run <script>` (and `npm test` / `npm start`) in the contributor docs and
//      .github/instructions/ exists in package.json `scripts`, and every `node <path>`
//      names a tracked file (#498)
//   2. every RELATIVE markdown link in them, inline or reference-style, resolves to a
//      TRACKED path inside the repository
//   3. AGENTS.md exists, is not ignored, and stays short enough to be a map
//   4. every .github/instructions/*.instructions.md defers to AGENTS.md and never cites
//      CLAUDE.md
//
// AGENTS.md is REQUIRED here, deliberately unlike the local-only guards (tool-count,
// compose_profile_sync, dual_transport_gate) that skip loudly when a file is absent.
// Those read files that are gitignored by policy. AGENTS.md was made PUBLIC by #496, so
// its absence means someone deleted or re-ignored it, which is the regression to catch.
//
// Links resolve against `git ls-files`, not the disk. CLAUDE.md, .claude/ and .env exist
// on the maintainer's machine and nowhere else, so a disk check passes a link to one of
// them locally and fails only in CI (or, worse, publishes a pointer to a private file).
//
// The NEGATIVE cases run the SAME predicates the real scan uses, against inline
// fixtures, so a broken extractor cannot pass by finding nothing.
//
// Prior art: agents-lint (https://github.com/giacomo/agents-lint) checks npm scripts and
// paths in agent files. It is not used here because it resolves paths on DISK (the trap
// above), reads the maintainer's home-directory memory files, and covers neither
// CONTRIBUTING, the PR template, the instructions-file footer nor a re-ignored AGENTS.md.
//
// Run: node tests/unit/contributor_docs.test.js

import assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, posix } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const DOCS = ['AGENTS.md', '.github/CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md'];
const INSTRUCTIONS_DIR = '.github/instructions';
const INSTRUCTIONS = readdirSync(join(ROOT, INSTRUCTIONS_DIR))
  .filter((f) => f.endsWith('.instructions.md'))
  .map((f) => `${INSTRUCTIONS_DIR}/${f}`);
const AGENTS_MAX_LINES = 150;
// Identical in every instructions file, so it is matched literally.
const DEFERENCE_FOOTER =
  'On conflict, follow the precedence in [AGENTS.md](../../AGENTS.md); this file adds detail for its applyTo glob and must not contradict it.';

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const SCRIPTS = new Set(Object.keys(JSON.parse(read('package.json')).scripts));
const TRACKED = new Set(
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean),
);

// `npm run build`, `npm run test:e2e:docker:full -- --fix`. The name stops at whitespace,
// a backtick or other punctuation; a placeholder such as `npm run <script>` does not match.
// A dot is allowed only BETWEEN name characters: the #496 spec's plain `[A-Za-z0-9:._-]+`
// captured sentence punctuation ("run npm run format." read as `format.`), which the
// negative fixture below caught.
// #498: leading flags are skipped (`npm run --silent build` names `build`), and a flag
// needs a letter after its dashes so the `--` argument separator is never read as one.
const NPM_RUN_RE =
  /\bnpm run((?:\s+--?[A-Za-z][\w-]*(?:=\S+)?)*)\s+([A-Za-z0-9:_-]+(?:\.[A-Za-z0-9:_-]+)*)/g;
// `npm test` and `npm start` are lifecycle shorthands for the scripts of the same name,
// and this repo deliberately has no `test` script.
const NPM_LIFECYCLE_RE = /\bnpm (test|start)\b/g;
function missingScripts(text, scripts) {
  const named = [...text.matchAll(NPM_RUN_RE)].map((m) => m[2])
    .concat([...text.matchAll(NPM_LIFECYCLE_RE)].map((m) => m[1]));
  return [...new Set(named)].filter((s) => !scripts.has(s));
}

// #498: `node <path>` must name a tracked file. `dist/` is build output and never tracked,
// so it is skipped; a placeholder such as `node scripts/<file>` does not match.
// #499: leading flags (`--flag`, `-f`, `--flag=value`) and a `--` end-of-options marker between
// `node` and the path are skipped; the path is group 2. Known, unpinned gap: flags that take a
// SEPARATE value (`-r x`, `--import x`) need a per-flag table of Node options, so they are not handled.
const NODE_TARGET_RE = /\bnode((?:\s+--?[A-Za-z][\w-]*(?:=\S+)?)*)(?:\s+--)?\s+((?:\.\/)?[\w./-]+\.(?:m?js|cjs|ts))\b/g;
function missingNodeTargets(text, isTracked) {
  const paths = [...text.matchAll(NODE_TARGET_RE)].map((m) => posix.normalize(m[2]));
  return [...new Set(paths)].filter((p) => !p.startsWith('dist/') && !isTracked(p));
}

// Inline links `[text](target)` (an image `![alt](src)` matches too, and is checked), then
// reference definitions `[label]: target`. Out of scope: any URL scheme (http:, https:,
// mailto:), protocol-relative `//`, and fragment-only `#anchor`. For `path#frag` or `path?q`
// only the path is checked. A relative target resolves against the CONTAINING file and a
// `/`-rooted one against the repository root, both as GitHub renders them.
//
// #498: code is stripped first, because a link written inside a fence or a code span is an
// example of syntax and GitHub does not render it as a link. Command checks still scan code.
// A footnote definition (`[^1]: text`) is excluded: its text is prose, not a target.
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REF_DEF_RE = /^[ \t]*\[(?!\^)[^\]]+\]:[ \t]*(\S+)/gm;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm;
const CODE_SPAN_RE = /`[^`\n]*`/g;
function stripCode(text) {
  return text.replace(FENCE_RE, '').replace(CODE_SPAN_RE, '');
}
function brokenLinks(text, docPath, isTracked) {
  const prose = stripCode(text);
  const targets = [...prose.matchAll(LINK_RE)].map((m) => m[1])
    .concat([...prose.matchAll(REF_DEF_RE)].map((m) => m[1].replace(/^<(.*)>$/, '$1')));
  const out = [];
  for (const target of targets) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) continue;
    let bare;
    try {
      bare = decodeURIComponent(target.split('#')[0].split('?')[0]);
    } catch {
      out.push(target); // malformed percent-encoding: GitHub cannot resolve it either
      continue;
    }
    if (!bare) continue;
    const resolved = bare.startsWith('/')
      ? posix.normalize(bare.slice(1) || '.')
      : posix.normalize(posix.join(posix.dirname(docPath), bare));
    if (resolved === '..' || resolved.startsWith('../')) {
      out.push(`${target} (escapes the repository)`);
      continue;
    }
    if (resolved === '.' || resolved === './') continue; // the repository root
    if (!isTracked(resolved)) out.push(target);
  }
  return out;
}
// A directory link (`.github/instructions/`) is fine when some tracked file lies under it.
function trackedPredicate(tracked) {
  return (p) => {
    const dir = p.endsWith('/') ? p : `${p}/`;
    return tracked.has(p.replace(/\/$/, '')) || [...tracked].some((t) => t.startsWith(dir));
  };
}

// Counts lines as `wc -l` does: a trailing newline ends the last line, it does not start
// a new one (a plain split would enforce 149 for a normal file).
function overLineCap(text, max) {
  const lines = text.replace(/\n$/, '').split('\n').length;
  return lines > max ? lines : null;
}

function instructionsProblems(text) {
  const out = [];
  if (text.includes('CLAUDE.md')) out.push('references CLAUDE.md, which is local-only');
  if (!text.includes(DEFERENCE_FOOTER)) out.push('lacks the AGENTS.md deference footer');
  return out;
}

console.log('\n[contributor-docs]');

check('AGENTS.md exists at the repository root (public since #496, never local-only)', () => {
  assert.ok(existsSync(join(ROOT, 'AGENTS.md')),
    'AGENTS.md is missing. It is a tracked, required file since #496');
});

check('AGENTS.md is tracked by git, not merely present on disk', () => {
  assert.ok(TRACKED.has('AGENTS.md'), 'AGENTS.md exists but is not in `git ls-files`; add and commit it');
});

check('AGENTS.md is not ignored by .gitignore', () => {
  // --no-index is load bearing: without it git never reports a TRACKED file as ignored,
  // so this would stay green with /AGENTS.md back in .gitignore.
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', 'AGENTS.md'], { cwd: ROOT });
  assert.notStrictEqual(r.status, 0,
    '.gitignore ignores AGENTS.md again. It is public by decision (#496); remove the /AGENTS.md pattern');
});

check(`AGENTS.md stays a map: at most ${AGENTS_MAX_LINES} lines`, () => {
  const over = overLineCap(read('AGENTS.md'), AGENTS_MAX_LINES);
  assert.strictEqual(over, null,
    `AGENTS.md has ${over} lines; link to a doc under docs/ instead of copying its content`);
});

const isTracked = trackedPredicate(TRACKED);
for (const doc of [...DOCS, ...INSTRUCTIONS]) {
  check(`${doc}: every npm script it names exists in package.json`, () => {
    const missing = missingScripts(read(doc), SCRIPTS);
    assert.deepStrictEqual(missing, [], `${doc} names script(s) not in package.json: ${missing.join(', ')}`);
  });
  check(`${doc}: every \`node <path>\` it names is a tracked file`, () => {
    const missing = missingNodeTargets(read(doc), isTracked);
    assert.deepStrictEqual(missing, [], `${doc} runs file(s) that are missing or not tracked: ${missing.join(', ')}`);
  });
}
for (const doc of [...DOCS, ...INSTRUCTIONS]) {
  check(`${doc}: every relative link resolves to a tracked path`, () => {
    const broken = brokenLinks(read(doc), doc, isTracked);
    assert.deepStrictEqual(broken, [], `${doc} links path(s) that are missing or not tracked: ${broken.join(', ')}`);
  });
}
for (const doc of INSTRUCTIONS) {
  check(`${doc}: defers to AGENTS.md and never cites CLAUDE.md`, () => {
    const problems = instructionsProblems(read(doc));
    assert.deepStrictEqual(problems, [], `${doc} ${problems.join('; ')}`);
  });
}

// NEGATIVE fixtures: the same predicates must flag what the real scan is meant to catch.
check('NEGATIVE: a missing script is reported by name; args and placeholders are not', () => {
  const text = 'Run `npm run build -- --x` then `npm run lint` and npm run format. See npm run <script>.';
  assert.deepStrictEqual(missingScripts(text, new Set(['build'])), ['lint', 'format']);
});

check('NEGATIVE: a broken relative link is reported; external, anchor and fragment links are not', () => {
  const text = [
    '[ok](../docs/A.md) [frag](../docs/A.md#x) [gone](../docs/DOES_NOT_EXIST.md)',
    '[web](https://example.com/x) [mail](mailto:) [anchor](#setup)',
  ].join('\n');
  const tracked = trackedPredicate(new Set(['docs/A.md']));
  assert.deepStrictEqual(brokenLinks(text, '.github/CONTRIBUTING.md', tracked), ['../docs/DOES_NOT_EXIST.md']);
});

check('NEGATIVE: a link to a file that exists on disk but is not tracked is reported', () => {
  const tracked = trackedPredicate(new Set(['README.md', '.github/instructions/a.instructions.md']));
  const text = '[readme](README.md) [local](CLAUDE.md) [dir](.github/instructions/)';
  assert.deepStrictEqual(brokenLinks(text, 'AGENTS.md', tracked), ['CLAUDE.md']);
});

check('NEGATIVE: a file over the line cap reports its line count', () => {
  assert.strictEqual(overLineCap(Array(151).fill('x').join('\n'), AGENTS_MAX_LINES), 151);
  assert.strictEqual(overLineCap(Array(150).fill('x').join('\n'), AGENTS_MAX_LINES), null);
  assert.strictEqual(overLineCap(`${Array(150).fill('x').join('\n')}\n`, AGENTS_MAX_LINES), null);
});

check('NEGATIVE: an instructions file citing CLAUDE.md without the footer reports both', () => {
  assert.deepStrictEqual(instructionsProblems('> On conflict, CLAUDE.md is authoritative.'), [
    'references CLAUDE.md, which is local-only',
    'lacks the AGENTS.md deference footer',
  ]);
});

// #498: forms the #496 predicates got wrong in one direction or the other. None occur in the
// docs today, which is why each is pinned by a fixture rather than left to the real scan.
check('NEGATIVE (#498): a broken reference-style definition is reported; an image link is checked', () => {
  const tracked = trackedPredicate(new Set(['docs/A.md']));
  const text = '[ok][a] and [gone][g]\n\n[a]: docs/A.md\n[g]: <docs/GONE.md>\n\n![img](docs/NO.png)';
  assert.deepStrictEqual(brokenLinks(text, 'AGENTS.md', tracked), ['docs/NO.png', 'docs/GONE.md']);
});

check('#498: a footnote definition is not a link target', () => {
  assert.deepStrictEqual(brokenLinks('[^1]: See the notes.', 'AGENTS.md', trackedPredicate(new Set())), []);
});

check('#498: links inside code spans and fences are examples, not links', () => {
  const text = 'Write `[x](docs/NOPE.md)` like this.\n\n```md\n[y](docs/NOPE2.md)\n[z]: docs/NOPE3.md\n```\n';
  assert.deepStrictEqual(brokenLinks(text, 'AGENTS.md', trackedPredicate(new Set())), []);
});

check('#498: a percent-encoded path is decoded; a malformed one is reported without throwing', () => {
  const tracked = trackedPredicate(new Set(['docs/A B.md']));
  assert.deepStrictEqual(brokenLinks('[f](docs/A%20B.md) [m](docs/%ZZ.md)', 'AGENTS.md', tracked), ['docs/%ZZ.md']);
});

check('#498: a root-relative link resolves against the repository root, as GitHub renders it', () => {
  const tracked = trackedPredicate(new Set(['docs/A.md']));
  assert.deepStrictEqual(brokenLinks('[d](/docs/A.md)', '.github/CONTRIBUTING.md', tracked), []);
});

check('NEGATIVE (#498): a link that escapes the repository says so', () => {
  const tracked = trackedPredicate(new Set(['outside.md']));
  assert.deepStrictEqual(brokenLinks('[x](../../outside.md)', 'AGENTS.md', tracked),
    ['../../outside.md (escapes the repository)']);
});

check('#498: flags before the script name are skipped; npm test and npm start need their scripts', () => {
  const text = 'Run `npm run --silent build`, then `npm test` and `npm start`.';
  assert.deepStrictEqual(missingScripts(text, new Set(['build', 'start'])), ['test']);
});

check('NEGATIVE (#498): a node target must be tracked, except build output under dist/', () => {
  const tracked = trackedPredicate(new Set(['scripts/ok.mjs']));
  const text = '`node scripts/ok.mjs` `node scripts/gone.mjs` `node dist/src/index.js --stdio` `node scripts/<file>`';
  assert.deepStrictEqual(missingNodeTargets(text, tracked), ['scripts/gone.mjs']);
});

check('NEGATIVE (#499): a node target after flags or -- is still checked', () => {
  const tracked = trackedPredicate(new Set());
  const text = '`node --experimental-vm-modules scripts/gone.mjs` `node -- scripts/d.mjs` '
    + '`node --experimental-vm-modules -- scripts/e.mjs` `node --x`';
  assert.deepStrictEqual(missingNodeTargets(text, tracked),
    ['scripts/gone.mjs', 'scripts/d.mjs', 'scripts/e.mjs']);
});

check('#499: a tracked node target after flags or -- is not reported', () => {
  const tracked = trackedPredicate(new Set(['scripts/ok.mjs']));
  const text = '`node --experimental-vm-modules scripts/ok.mjs` `node --max-old-space-size=4096 scripts/ok.mjs` `node -- scripts/ok.mjs`';
  assert.deepStrictEqual(missingNodeTargets(text, tracked), []);
  // Not vacuous: all three forms must actually be recognised, with the path in group 2.
  assert.deepStrictEqual([...text.matchAll(NODE_TARGET_RE)].map((m) => m[2]),
    ['scripts/ok.mjs', 'scripts/ok.mjs', 'scripts/ok.mjs']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
