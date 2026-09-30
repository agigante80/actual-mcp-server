// tests/unit/contributor_docs.test.js
//
// #496: the files an outside contributor (or their coding agent) reads first must not
// send them to commands and paths that do not exist. CONTRIBUTING.md had drifted into
// exactly that state: it named `npm run test:unit`, `npm run lint` and `npm run format`,
// none of which were scripts, and a `test/` tree that had been `tests/` for a long time.
// Nothing looked, so nothing noticed.
//
// Asserted here:
//   1. every `npm run <script>` in the contributor docs exists in package.json `scripts`
//   2. every RELATIVE markdown link in them, and in .github/instructions/, resolves to a
//      TRACKED path
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
const NPM_RUN_RE = /\bnpm run ([A-Za-z0-9:_-]+(?:\.[A-Za-z0-9:_-]+)*)/g;
function missingScripts(text, scripts) {
  return [...new Set([...text.matchAll(NPM_RUN_RE)].map((m) => m[1]))].filter((s) => !scripts.has(s));
}

// Inline links `[text](target)`. Out of scope: any URL scheme (http:, https:, mailto:),
// protocol-relative `//`, and fragment-only `#anchor`. For `path#frag` or `path?q` only
// the path is checked. Targets resolve relative to the CONTAINING file, as GitHub does.
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
function brokenLinks(text, docPath, isTracked) {
  const out = [];
  for (const [, target] of text.matchAll(LINK_RE)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) continue;
    const bare = target.split('#')[0].split('?')[0];
    if (!bare) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(docPath), bare));
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
  check(`${doc}: every \`npm run\` script it names exists in package.json`, () => {
    const missing = missingScripts(read(doc), SCRIPTS);
    assert.deepStrictEqual(missing, [], `${doc} names script(s) not in package.json: ${missing.join(', ')}`);
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
