/**
 * #602: docs:check module "links", an offline link and anchor check run by lychee.
 *
 * Every markdown file the markers module enumerates (git ls-files in a checkout, a
 * recursive walk otherwise; one enumerator so both modules see the same set, and a
 * temp tree in a test is never scanned as zero files) is fed to lychee with:
 *
 *   --offline            no network: external URLs are out of scope for CI (flaky)
 *   --include-fragments  without it a link to a deleted heading in an existing file
 *                        passes; tests/unit/docs_links_fixture.test.js proves it
 *   --exclude-path tests/fixtures/lychee
 *                        the deliberately broken negative fixture
 *
 * Problems are `<file>:<line> <url> (<reason>)` with `<url>` made root-relative, for
 * example `docs/a.md:7 docs/NOT_A_FILE.md (file not found)`. lychee 0.24.2's JSON
 * report carries `span.line` for every markdown link, so the line is always there;
 * if a future lychee drops it, the problem degrades to `<file> <url> (<reason>)`.
 *
 * Same-file fragments (lycheeverse/lychee#1613) ARE reported by lychee 0.24.2 under
 * --include-fragments, which the fixture test asserts, so this module carries no
 * anchor check of its own.
 *
 * Without lychee on PATH the module returns `skipped`; check.mjs decides whether a
 * skip is a failure (it is whenever CI is set).
 */

import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMarkdownFiles } from './markers.mjs';

export const name = 'links';

export const FIXTURE_EXCLUDE = 'tests/fixtures/lychee';

/** The lychee flags of the real run, exported so the fixture test runs exactly these. */
export const LYCHEE_ARGS = [
  '--offline',
  '--include-fragments',
  '--no-progress',
  '--format', 'json',
  '--exclude-path', FIXTURE_EXCLUDE,
  '--files-from', '-',
];

/** Oldest lychee whose JSON report this module parses; older ones fail as "not JSON". */
const MIN_LYCHEE = [0, 24];

/** null when a usable lychee is on PATH, else the skip reason. */
export function lycheeUnavailable() {
  const r = spawnSync('lychee', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 'lychee not installed';
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout || '');
  if (!m) return 'lychee version unreadable, 0.24.2 required';
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major < MIN_LYCHEE[0] || (major === MIN_LYCHEE[0] && minor < MIN_LYCHEE[1])) {
    return `lychee ${m[0]} found, 0.24.2 required`;
  }
  return null;
}

/** `file:///abs/root/docs/x.md#frag` to `docs/x.md#frag`; anything else unchanged. */
function displayUrl(url, root) {
  if (!url.startsWith('file://')) return url;
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  const frag = hash === -1 ? '' : url.slice(hash);
  let path;
  try {
    path = fileURLToPath(base);
  } catch {
    return url;
  }
  const rel = relative(root, path);
  return (rel.startsWith('..') ? path : rel).split(sep).join('/') + frag;
}

/** "File not found. Check if file exists..." to "file not found". */
function shortReason(status) {
  const text = String(status?.text ?? status?.details ?? 'error');
  const first = text.split('. ')[0].replace(/\.$/, '');
  return first.charAt(0).toLowerCase() + first.slice(1);
}

/** Turn lychee's `--format json` report into unprefixed problem lines. */
export function parseLycheeReport(report, root) {
  const problems = [];
  for (const [file, entries] of Object.entries(report?.error_map ?? {})) {
    const rel = relative(root, resolve(root, file)).split(sep).join('/');
    for (const e of entries) {
      const where = e?.span?.line ? `${rel}:${e.span.line}` : rel;
      problems.push(`${where} ${displayUrl(String(e.url), root)} (${shortReason(e.status)})`);
    }
  }
  return problems.sort();
}

/**
 * Run lychee over `files` (root-relative) with `args`, from `root`. Returns the
 * problem lines. Exit 0 is clean and exit 2 is "links failed"; anything else (bad
 * flag, unreadable input) is itself reported as a problem rather than passing.
 */
export function runLychee({ root, files, args = LYCHEE_ARGS }) {
  const r = spawnSync('lychee', args, {
    cwd: root,
    input: files.join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return [`lychee failed to start: ${r.error.message}`];
  if (r.status !== 0 && r.status !== 2) {
    return [`lychee exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`];
  }
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    return [`lychee output is not JSON (exit ${r.status})`];
  }
  const problems = parseLycheeReport(report, root);
  // Exit 2 with an empty error_map would otherwise pass silently.
  if (r.status === 2 && problems.length === 0) return ['lychee exited 2 but reported no broken link'];
  return problems;
}

export async function check({ root }) {
  const unavailable = lycheeUnavailable();
  if (unavailable) {
    return { name, problems: [], skipped: { tool: 'lychee', reason: unavailable } };
  }
  const absRoot = resolve(root);
  const files = listMarkdownFiles(absRoot);
  if (files.length === 0) return { name, problems: ['no markdown files found to check'] };
  return { name, problems: runLychee({ root: absRoot, files }) };
}
