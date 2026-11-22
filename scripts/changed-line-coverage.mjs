#!/usr/bin/env node
// scripts/changed-line-coverage.mjs
//
// #720: a warn-only report of which CHANGED src/ lines the unit and adapter
// suites execute. No dependency: Node writes raw V8 coverage when
// NODE_V8_COVERAGE is set, and with it a "source-map-cache" entry per script
// that carries a source map. This script merges those files, maps generated
// lines back to src/ lines and intersects them with a diff.
//
// Rules (they are the contract the unit test pins):
//   - A generated line takes the count of the innermost V8 range that fully
//     covers it.
//   - A source line is EXECUTED when any generated line mapped to it was
//     executed in any process.
//   - A source line with no mapping (types, comments, blanks) is not
//     executable and is left out of every count.
//   - A changed file no process loaded is reported as "not loaded".
//
// The report never fails a build: missing data prints a `skip:` line and
// exits 0. Only --collect can exit non-zero, when the suites themselves fail.
//
// Usage:
//   node scripts/changed-line-coverage.mjs [--coverage-dir coverage/v8]
//        [--base <ref> | --diff-file <path>] [--root <dir>] [--summary <file>]
//   node scripts/changed-line-coverage.mjs --collect [--base <ref>] [--summary <file>]
//
// The source map cache is documented by Node as experimental. If its shape
// changes, tests/unit/changed_line_coverage.test.js fails (it runs a real
// process under NODE_V8_COVERAGE), which is the signal to revisit #720.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/**
 * Decode a source map `mappings` string.
 * Returns one array per generated line holding [sourceIndex, sourceLine0] pairs.
 */
export function decodeMappings(mappings) {
  const lines = [];
  let src = 0;
  let srcLine = 0;
  for (const lineText of String(mappings).split(';')) {
    const pairs = [];
    for (const seg of lineText.split(',')) {
      if (!seg) continue;
      const fields = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64_INDEX.get(ch);
        if (digit === undefined) throw new Error(`invalid base64 VLQ character "${ch}"`);
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; continue; }
        fields.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
      }
      // 1 field: generated column only (no source). 4 or 5: with a source position.
      if (fields.length >= 4) {
        src += fields[1];
        srcLine += fields[2];
        pairs.push([src, srcLine]);
      }
    }
    lines.push(pairs);
  }
  return lines;
}

/**
 * Per generated line: true when the innermost V8 range fully covering the
 * line has a count above zero. `lineLengths` excludes the newline.
 */
export function lineHits(lineLengths, functions) {
  const starts = [];
  let offset = 0;
  for (const len of lineLengths) { starts.push(offset); offset += len + 1; }
  const ranges = [];
  for (const fn of functions || []) for (const r of fn.ranges || []) ranges.push(r);
  // Outer ranges first, so an inner range assigned later overrides them.
  ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const counts = new Array(lineLengths.length).fill(0);
  for (const r of ranges) {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < r.startOffset) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < starts.length && starts[i] + lineLengths[i] <= r.endOffset; i += 1) counts[i] = r.count;
  }
  return counts.map((c) => c > 0);
}

/**
 * Parse a unified diff. Returns Map<path, number[]> of ADDED or changed line
 * numbers (new side) for src/**\/*.ts files only.
 */
export function changedSrcLines(diffText) {
  const out = new Map();
  let file = null;
  let line = 0;
  let inHunk = false;
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('diff --git ')) { file = null; inHunk = false; continue; }
    if (!inHunk && raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim().replace(/^b\//, '');
      file = /^src\/.+\.ts$/.test(p) && !p.endsWith('.d.ts') ? p : null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { line = Number(hunk[1]); inHunk = true; continue; }
    if (!inHunk || !file) continue;
    if (raw.startsWith('+')) {
      if (!out.has(file)) out.set(file, []);
      out.get(file).push(line);
      line += 1;
    } else if (raw.startsWith(' ')) {
      line += 1;
    }
  }
  return out;
}

/**
 * Merge every coverage file in `dir`.
 * Returns { files, withMaps, sources } where sources is
 * Map<repoRelativeSource, { executable: Set<line>, executed: Set<line> }>.
 */
export function readCoverage(dir, root) {
  const rootUrl = pathToFileURL(path.resolve(root) + path.sep).href;
  const generatedPrefix = rootUrl + 'dist/src/';
  const merged = new Map(); // generated url -> { hits: boolean[], data }
  let files = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    files += 1;
    const cache = parsed['source-map-cache'] || {};
    for (const script of parsed.result || []) {
      if (typeof script.url !== 'string' || !script.url.startsWith(generatedPrefix)) continue;
      const entry = cache[script.url];
      if (!entry || !entry.data || !Array.isArray(entry.lineLengths)) continue;
      const hits = lineHits(entry.lineLengths, script.functions);
      const prev = merged.get(script.url);
      if (!prev) { merged.set(script.url, { hits, data: entry.data }); continue; }
      for (let i = 0; i < hits.length; i += 1) if (hits[i]) prev.hits[i] = true;
    }
  }
  const sources = new Map();
  for (const [url, { hits, data }] of merged) {
    const base = new URL(data.sourceRoot || '', url);
    const names = (data.sources || []).map((s) => {
      const abs = new URL(s, base).href;
      return abs.startsWith(rootUrl) ? decodeURIComponent(abs.slice(rootUrl.length)) : null;
    });
    const mapped = decodeMappings(data.mappings || '');
    for (let g = 0; g < mapped.length; g += 1) {
      for (const [srcIndex, srcLine0] of mapped[g]) {
        const rel = names[srcIndex];
        if (!rel) continue;
        if (!sources.has(rel)) sources.set(rel, { executable: new Set(), executed: new Set() });
        const rec = sources.get(rel);
        rec.executable.add(srcLine0 + 1);
        if (hits[g]) rec.executed.add(srcLine0 + 1);
      }
    }
  }
  return { files, withMaps: merged.size, sources };
}

/** "3, 7 to 9" for [3, 7, 8, 9]. */
export function compressLines(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j === i ? String(sorted[i]) : j === i + 1 ? `${sorted[i]}, ${sorted[j]}` : `${sorted[i]} to ${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/** One row per changed src file. */
export function buildRows(changed, sources) {
  const rows = [];
  for (const file of [...changed.keys()].sort()) {
    const lines = changed.get(file);
    const rec = sources.get(file);
    if (!rec) { rows.push({ file, loaded: false, changed: lines.length }); continue; }
    const executable = lines.filter((l) => rec.executable.has(l));
    const missed = executable.filter((l) => !rec.executed.has(l));
    rows.push({
      file, loaded: true, changed: lines.length, executable: executable.length,
      executed: executable.length - missed.length, missed,
    });
  }
  return rows;
}

export function renderReport(rows, { partial = false } = {}) {
  const out = ['### Changed-line coverage (unit and adapter suites, warn-only)', ''];
  // A failed chain stops at its first red test, so every later test wrote no coverage.
  if (partial) out.push('partial: a test chain failed during collection, so the tests after the failure did not run. Lines below may read as not executed only for that reason; see the job log.', '');
  out.push('| File | Changed lines | Executable | Executed | Percent | Not executed |');
  out.push('|------|---------------|------------|----------|---------|--------------|');
  for (const r of rows) {
    if (!r.loaded) { out.push(`| \`${r.file}\` | ${r.changed} | not loaded by any test process | | | |`); continue; }
    if (r.executable === 0) { out.push(`| \`${r.file}\` | ${r.changed} | 0 | | | no executable changed line |`); continue; }
    const pct = Math.floor((r.executed / r.executable) * 100);
    out.push(`| \`${r.file}\` | ${r.changed} | ${r.executable} | ${r.executed} | ${pct} percent | ${compressLines(r.missed)} |`);
  }
  out.push('', 'A line counts as executed when any unit or adapter test process ran it. E2E and integration runs are not measured. This report never fails the build.');
  return out.join('\n');
}

function parseArgs(argv) {
  const opts = { collect: false, coverageDir: 'coverage/v8', base: null, diffFile: null, root: process.cwd(), summary: null };
  const valued = { '--coverage-dir': 'coverageDir', '--base': 'base', '--diff-file': 'diffFile', '--root': 'root', '--summary': 'summary' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--collect') { opts.collect = true; continue; }
    if (valued[a]) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      opts[valued[a]] = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  // Collection wipes and refills its directory, so it only ever uses the default one.
  if (opts.collect && opts.coverageDir !== 'coverage/v8') throw new Error('--collect always writes coverage/v8; --coverage-dir is for report-only runs');
  return opts;
}

function emit(opts, text) {
  process.stdout.write(text + '\n');
  if (opts.summary) appendFileSync(opts.summary, text + '\n');
}

function readDiff(opts) {
  if (opts.diffFile) {
    if (!existsSync(opts.diffFile)) return { skip: `diff file ${opts.diffFile} does not exist` };
    return { text: readFileSync(opts.diffFile, 'utf8') };
  }
  const base = opts.base || 'origin/develop';
  // The base is passed as one argv entry, never through a shell.
  if (!/^[\w./@^~-]+$/.test(base) || base.startsWith('-')) return { skip: `base ref "${base}" is not a plain ref` };
  // The prefixes are pinned: diff.mnemonicPrefix or diff.noprefix in a user's git config would
  // otherwise write "+++ w/src/x.ts" or "+++ src/x.ts" and every file would be missed.
  const r = spawnSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', base, '--', 'src'],
    { cwd: opts.root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return { skip: `git diff against ${base} failed: ${(r.stderr || '').trim().split('\n')[0]}` };
  return { text: r.stdout };
}

// Collection leaves its outcome beside the coverage files, so a later report-only run over a
// failed or interrupted collection still says the data is partial.
const STATUS_FILE = 'collection-status.txt';

export function collectionIsPartial(dir) {
  const f = path.join(dir, STATUS_FILE);
  return existsSync(f) && readFileSync(f, 'utf8').trim() !== '0';
}

function report(opts, changed) {
  const dir = path.resolve(opts.root, opts.coverageDir);
  if (!existsSync(dir)) { emit(opts, `skip: changed-line coverage: coverage directory ${opts.coverageDir} does not exist (run npm run test:coverage)`); return; }
  const cov = readCoverage(dir, opts.root);
  if (cov.withMaps === 0) { emit(opts, `skip: changed-line coverage: ${cov.files} coverage file(s) in ${opts.coverageDir} hold no source-mapped dist/src script (run npm run test:coverage)`); return; }
  emit(opts, renderReport(buildRows(changed, cov.sources), { partial: collectionIsPartial(dir) }));
}

function run(cmd, args, options) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  return r.status === null ? 1 : r.status;
}

function collect(opts) {
  const root = opts.root;
  const covDir = path.resolve(root, 'coverage/v8');
  const logFile = path.resolve(root, 'coverage/changed-line-coverage.log');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  rmSync(covDir, { recursive: true, force: true });
  mkdirSync(covDir, { recursive: true });
  writeFileSync(logFile, '');
  const statusFile = path.join(covDir, STATUS_FILE);
  writeFileSync(statusFile, 'incomplete\n');
  let status = 0;
  try {
    // Coverage-only build: inline source maps into dist/, where the tests look.
    status = run('npm', ['run', 'build', '--', '--inlineSourceMap'], { cwd: root });
    if (status !== 0) { writeFileSync(statusFile, `${status}\n`); return status; }
    const env = { ...process.env, NODE_V8_COVERAGE: covDir };
    // The chains run from their package.json text, not through `npm run`: npm is
    // a Node process too and would add its own coverage file, and test:adapter
    // would rebuild dist/ without the maps.
    const chains = [
      ['unit', pkg.scripts['test:unit-js']],
      ['adapter', 'node dist/src/tests_adapter_runner.js'],
    ];
    for (const [name, script] of chains) {
      const r = spawnSync(script, { cwd: root, env, shell: true, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
      appendFileSync(logFile, `==== ${name} (exit ${r.status}) ====\n${r.stdout || ''}${r.stderr || ''}\n`);
      if (r.status !== 0) {
        status = r.status === null ? 1 : r.status;
        const tail = `${r.stdout || ''}${r.stderr || ''}`.trimEnd().split('\n').slice(-25).join('\n');
        process.stderr.write(`changed-line coverage: the ${name} chain failed under collection (exit ${r.status}); last lines:\n${tail}\nfull log: coverage/changed-line-coverage.log\n`);
      }
    }
    writeFileSync(statusFile, `${status}\n`);
    return status;
  } finally {
    // Always leave dist/ as the normal build.
    const rebuilt = run('npm', ['run', 'build'], { cwd: root });
    if (rebuilt !== 0) process.stderr.write('changed-line coverage: the plain rebuild failed; run npm run build\n');
  }
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) { process.stderr.write(`${err.message}\n`); process.exit(2); }
  const diff = readDiff(opts);
  if (diff.skip) { emit(opts, `skip: changed-line coverage: ${diff.skip}`); return; }
  const changed = changedSrcLines(diff.text);
  if (changed.size === 0) { emit(opts, 'changed-line coverage: no src/ line changed, nothing to measure'); return; }
  let status = 0;
  if (opts.collect) status = collect(opts);
  report(opts, changed);
  process.exitCode = status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
