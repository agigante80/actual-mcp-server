// tests/unit/readme_stats_sync.test.js
//
// #236: README.md carries hardcoded stats that no guard enforces (badge versions,
// concurrent-session count, retry-attempt count). Two badges had already drifted from
// package.json. This guard pins every such stat to its single canonical source so it
// cannot silently rot again, the same way tool_count_sync pins the tool count. It is a
// PURE text/source-parsing guard: no module import, no network, no @actual-app/api, so
// it runs deterministically on any Node and never depends on installed node_modules.
//
// Canonical sources:
//   - TypeScript / Node badges        -> the DECLARED package.json ranges
//     (devDependencies.typescript, engines.node)
//   - "up to N concurrent sessions"   -> the .default('N') literal of MAX_CONCURRENT_SESSIONS
//     in src/config.ts
//   - "N attempts, exponential backoff" -> DEFAULT_RETRY_ATTEMPTS in src/lib/constants.ts
//   - coverage claim                  -> de-hardcoded: the README must carry NO "NN% ... Actual
//     Budget API" literal (a rotting percentage), the gaps are reported by check:coverage.
//
//   - (#601) ActualQL bullet          -> the README's own "Exclusive ActualQL-powered (N)" heading
//     and the number of table rows under it
//   - (#601) toolset table sum        -> the string entries of the TOOLSETS literal in
//     src/lib/toolsets.ts
//   - (#601) write-capable count      -> the string entries of the WRITE_CAPABLE literal
//   #603 will generate these README numbers and retarget or retire the three #601 checks.
//
// Run: node tests/unit/readme_stats_sync.test.js

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

// ----- canonical-source extractors (deterministic, declared values only) -----

// Strip a leading range operator (^, ~, >=, >, =) and return the first N dot-segments.
function versionSegments(range, n) {
  const cleaned = String(range).replace(/^[\^~>=<\s]*/, '');
  return cleaned.split('.').slice(0, n).join('.');
}
const majorMinor = (range) => versionSegments(range, 2);
const major = (range) => versionSegments(range, 1);

const pkg = JSON.parse(read('package.json'));
const CANON = {
  ts: majorMinor(pkg.devDependencies.typescript),                       // "6.0"
  node: major(pkg.engines.node),                                        // "22"
};

// MAX_CONCURRENT_SESSIONS default literal from src/config.ts (the literal, not a runtime
// env-overridable value).
function sessionDefault() {
  const src = read('src/config.ts');
  const m = src.match(/MAX_CONCURRENT_SESSIONS:[^\n]*\.default\(\s*['"](\d+)['"]\s*\)/);
  assert(m, 'could not find MAX_CONCURRENT_SESSIONS .default(...) literal in src/config.ts');
  return m[1];
}

// DEFAULT_RETRY_ATTEMPTS literal from src/lib/constants.ts.
function retryAttempts() {
  const src = read('src/lib/constants.ts');
  const m = src.match(/export const DEFAULT_RETRY_ATTEMPTS\s*=\s*(\d+)\s*;/);
  assert(m, 'could not find DEFAULT_RETRY_ATTEMPTS literal in src/lib/constants.ts');
  return m[1];
}

// ----- comparators (pure; the negative fixtures call these directly) -----

// Return the list of badge mismatch labels between a README string and the canonical
// (declared) versions. Empty array means every badge matches.
function badgeMismatches(readme, canon) {
  const out = [];
  const ts = readme.match(/TypeScript-([0-9.]+)-/);
  if (!ts) out.push('TypeScript badge not found');
  else if (ts[1] !== canon.ts) out.push(`TypeScript badge ${ts[1]} != package.json ${canon.ts}`);

  const node = readme.match(/node-%3E%3D([0-9]+)/);
  if (!node) out.push('Node badge not found');
  else if (node[1] !== canon.node) out.push(`Node badge major ${node[1]} != package.json ${canon.node}`);

  return out;
}

// Return mismatch labels for every "up to N concurrent session(s)" occurrence vs the expected
// value. Empty array means all occurrences match (and at least one exists).
function sessionMismatches(readme, expected) {
  const hits = [...readme.matchAll(/up to (\d+) concurrent session/gi)].map((m) => m[1]);
  if (hits.length === 0) return ['no "up to N concurrent sessions" phrase found in README'];
  return hits.filter((n) => n !== String(expected)).map((n) => `concurrent-sessions ${n} != ${expected}`);
}

// Return mismatch labels for every "N attempts, exponential backoff" occurrence vs expected.
function attemptMismatches(readme, expected) {
  const hits = [...readme.matchAll(/(\d+) attempts, exponential backoff/gi)].map((m) => m[1]);
  if (hits.length === 0) return ['no "N attempts, exponential backoff" phrase found in README'];
  return hits.filter((n) => n !== String(expected)).map((n) => `retry-attempts ${n} != ${expected}`);
}

// A rotting coverage percentage like "Covers 87% of the Actual Budget API". The claim must be
// qualitative (no number that can drift). Returns the offending literal, or null if clean.
// Tolerates a period/newline between the number and the phrase (so "Covers 87%. Actual Budget
// API ..." cannot slip through), and also catches a bare "Covers NN%" lead-in. The README
// carries no legitimate "NN%" literal, so these are safe to forbid wholesale.
function coveragePercentLiteral(readme) {
  const patterns = [
    /\d+%[\s\S]{0,40}Actual Budget API/i, // "87% of the Actual Budget API", period/newline tolerant
    /Covers\s+\d+%/i,                     // "Covers 87%" lead-in regardless of what follows
  ];
  for (const re of patterns) { const m = readme.match(re); if (m) return m[0]; }
  return null;
}

// #241: the README prose must not hardcode a dependency version that drifts from package.json
// (the guarded badges already convey them). Returns every unguarded dependency-version literal
// found. The version-bearing badges use a hyphen ("TypeScript-6.0"), and bare
// package-name mentions carry no version, so neither is matched here.
function dependencyVersionLiterals(readme) {
  const patterns = [
    /@modelcontextprotocol\/sdk`?\s*[v^]?\d+\.\d+/gi, // "@modelcontextprotocol/sdk ^1.25.2"
    /@actual-app\/api`?\s*[v^]?\d+\.\d+/gi,           // "@actual-app/api ^26.3.0"
    /\bTypeScript\s+\d+\.\d+/g,                        // prose "TypeScript 5.9" (not the badge)
  ];
  const hits = [];
  for (const re of patterns) hits.push(...[...readme.matchAll(re)].map((m) => m[0]));
  return hits;
}

// ----- #601: README counts pinned to their sources (a bridge until #603 generates them) -----

// The text of the first `export const NAME ... = ` literal up to its closing bracket line. The
// parse is bounded to ONE literal because PRESETS also holds `'actual_...'` strings, and names
// carry capitals (`actual_budgets_getMonth`), so the class is [A-Za-z_], not [a-z_].
function literalBody(src, name, close) {
  const start = src.indexOf(`export const ${name}`);
  assert(start >= 0, `could not find the ${name} literal in src/lib/toolsets.ts`);
  const end = src.indexOf(close, start);
  assert(end > start, `could not find the end of the ${name} literal`);
  return src.slice(start, end);
}
const toolNames = (body) => [...body.matchAll(/'(actual_[A-Za-z_]+)'/g)].map((m) => m[1]);
function registryCounts() {
  const src = read('src/lib/toolsets.ts');
  return {
    tools: toolNames(literalBody(src, 'TOOLSETS', '\n} as const')).length,
    write: toolNames(literalBody(src, 'WRITE_CAPABLE', '\n]);')).length,
  };
}

// (a) The "N exclusive ActualQL-powered tools" bullet vs the "Exclusive ActualQL-powered (N)"
// heading and the table rows under it. Returns mismatch labels naming both numbers.
function actualqlMismatches(readme) {
  const bullet = readme.match(/(\d+) exclusive ActualQL-powered/);
  const heading = readme.match(/Exclusive ActualQL-powered \((\d+)\)/);
  if (!bullet) return ['no "N exclusive ActualQL-powered" bullet found in README'];
  if (!heading) return ['no "Exclusive ActualQL-powered (N)" heading found in README'];
  const after = readme.slice(heading.index + heading[0].length);
  const rows = (after.split(/\n\s*\n/)[1] || '').split('\n').filter((l) => /^\| `actual_/.test(l)).length;
  const out = [];
  if (bullet[1] !== heading[1]) out.push(`ActualQL bullet says ${bullet[1]}, heading says ${heading[1]}`);
  if (String(rows) !== heading[1]) out.push(`ActualQL heading says ${heading[1]}, table has ${rows} rows`);
  return out;
}

// (b) The `### Reducing the tool surface` table: the Tools column must sum to the registry total.
function toolsetTableMismatches(readme, registryTotal) {
  const at = readme.indexOf('### Reducing the tool surface');
  if (at < 0) return ['no "### Reducing the tool surface" section found in README'];
  const section = readme.slice(at + 1);
  const end = section.search(/\n#{2,3} /);
  const rows = [...(end < 0 ? section : section.slice(0, end)).matchAll(/^\| `[a-z]+` \| (\d+) \|/gm)];
  if (rows.length === 0) return ['no toolset table rows found in README'];
  const sum = rows.reduce((n, m) => n + Number(m[1]), 0);
  return sum === registryTotal ? [] : [`toolset table sums to ${sum}, registry has ${registryTotal}`];
}

// (c) The write-capable count: the "(N of the M, including ..., leaving K)" sentence and the
// MCP_READ_ONLY row's "the N write-capable" against WRITE_CAPABLE (and the registry total).
function writeCountMismatches(readme, writeCount, registryTotal) {
  const out = [];
  const bad = (n) => `write-capable count ${n}, WRITE_CAPABLE has ${writeCount}`;
  const sentence = readme.match(/\((\d+) of the (\d+), including[^)]*\), leaving (\d+)/);
  if (!sentence) out.push('no "(N of the M, including ..., leaving K)" write sentence found in README');
  else {
    if (Number(sentence[1]) !== writeCount) out.push(bad(sentence[1]));
    if (Number(sentence[2]) !== registryTotal) out.push(`write sentence says ${sentence[2]} tools, registry has ${registryTotal}`);
    if (Number(sentence[3]) !== registryTotal - writeCount) out.push(`write sentence leaves ${sentence[3]}, expected ${registryTotal - writeCount}`);
  }
  const row = readme.match(/the (\d+) write-capable/);
  if (!row) out.push('no "the N write-capable" MCP_READ_ONLY row found in README');
  else if (Number(row[1]) !== writeCount) out.push(bad(row[1]));
  return out;
}

console.log('\n[readme-stats-sync]');

const README = read('README.md');

check('TypeScript / Node badges match the declared package.json versions', () => {
  const bad = badgeMismatches(README, CANON);
  assert.strictEqual(bad.length, 0, `badge drift: ${bad.join('; ')}`);
});

check('"up to N concurrent sessions" matches MAX_CONCURRENT_SESSIONS default in src/config.ts', () => {
  const expected = sessionDefault();
  const bad = sessionMismatches(README, expected);
  assert.strictEqual(bad.length, 0, `${bad.join('; ')} (canonical=${expected})`);
});

check('"N attempts, exponential backoff" matches DEFAULT_RETRY_ATTEMPTS in src/lib/constants.ts', () => {
  const expected = retryAttempts();
  const bad = attemptMismatches(README, expected);
  assert.strictEqual(bad.length, 0, `${bad.join('; ')} (canonical=${expected})`);
});

check('README carries no hardcoded coverage percentage (de-hardcoded)', () => {
  const lit = coveragePercentLiteral(README);
  assert.strictEqual(lit, null, `README still claims a rotting coverage percentage: "${lit}"`);
});

check('README prose carries no unguarded dependency-version literal (de-hardcoded)', () => {
  const hits = dependencyVersionLiterals(README);
  assert.deepStrictEqual(hits, [],
    `README hardcodes dependency version(s) that can drift from package.json: ${hits.join('; ')}`);
});


check('(#601) the ActualQL bullet matches its heading and table', () => {
  const bad = actualqlMismatches(README);
  assert.strictEqual(bad.length, 0, bad.join('; '));
});

check('(#601) the toolset table sums to the TOOLSETS registry', () => {
  const { tools } = registryCounts();
  const bad = toolsetTableMismatches(README, tools);
  assert.strictEqual(bad.length, 0, bad.join('; '));
});

check('(#601) the write-capable counts equal WRITE_CAPABLE', () => {
  const { tools, write } = registryCounts();
  const bad = writeCountMismatches(README, write, tools);
  assert.strictEqual(bad.length, 0, bad.join('; '));
});

check('(#601) the registry parse counts mixed-case names (not a [a-z_] undercount)', () => {
  const { tools, write } = registryCounts();
  assert.ok(tools >= 84 && write >= 48, `registry parse looks undercounted: ${tools} tools, ${write} write-capable`);
});

// ----- NEGATIVE in-test fixtures: prove each comparator flags synthetic drift -----

check('NEGATIVE: a drifted TypeScript badge is detected by badgeMismatches', () => {
  const fixture = '[![TypeScript](https://img.shields.io/badge/TypeScript-4.0-blue)] '
    + '[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)]';
  const bad = badgeMismatches(fixture, CANON);
  assert.ok(
    bad.some((m) => m.startsWith('TypeScript badge 4.0')),
    `comparator must flag the drifted TypeScript badge, got: ${JSON.stringify(bad)}`,
  );
});

check('NEGATIVE: a drifted concurrent-sessions number is detected', () => {
  const bad = sessionMismatches('pooling (up to 99 concurrent sessions) and', '15');
  assert.deepStrictEqual(bad, ['concurrent-sessions 99 != 15']);
});

check('NEGATIVE: a reintroduced coverage percentage is detected', () => {
  const lit = coveragePercentLiteral('and more. Covers 87% of the Actual Budget API.');
  assert.strictEqual(lit, '87% of the Actual Budget API');
});

check('NEGATIVE: a percentage split from the phrase by a period does not slip through', () => {
  assert.ok(coveragePercentLiteral('Covers 87%. The Actual Budget API is fully mapped.'),
    'a percentage near the coverage claim must be caught even across a period');
});

check('NEGATIVE: reintroduced unguarded dependency-version literals are detected', () => {
  const hits = dependencyVersionLiterals(
    '- **Language**: TypeScript 5.9\n- **MCP SDK**: `@modelcontextprotocol/sdk` ^1.29.0\n- **Actual API**: `@actual-app/api` ^26.6.0',
  );
  assert.ok(hits.some((h) => /TypeScript 5\.9/.test(h)), `must flag TypeScript prose version, got ${JSON.stringify(hits)}`);
  assert.ok(hits.some((h) => h.includes('@modelcontextprotocol/sdk')), 'must flag the MCP SDK version literal');
  assert.ok(hits.some((h) => h.includes('@actual-app/api')), 'must flag the Actual API version literal');
});

check('POSITIVE: bare package-name mentions and the hyphenated badges are NOT flagged', () => {
  const hits = dependencyVersionLiterals(
    'The `@actual-app/api` library downloads data. badge/TypeScript-6.0-blue',
  );
  assert.deepStrictEqual(hits, [], `comparator must not false-positive on bare names/badges, got ${JSON.stringify(hits)}`);
});

check('NEGATIVE: an ActualQL bullet that disagrees with its heading is detected', () => {
  const fixture = '- **6 exclusive ActualQL-powered tools.** x\n\n**Exclusive ActualQL-powered (8)**, unique\n\n| Tool | D |\n|---|---|\n'
    + Array.from({ length: 8 }, (_, i) => `| \`actual_t${i}\` | d |`).join('\n') + '\n';
  assert.deepStrictEqual(actualqlMismatches(fixture), ['ActualQL bullet says 6, heading says 8']);
});

check('NEGATIVE: a toolset table that does not sum to the registry is detected', () => {
  const fixture = '### Reducing the tool surface\n\n| Toolset | Tools | C |\n|---|---|---|\n| `context` | 40 | a |\n| `admin` | 43 | b |\n';
  assert.deepStrictEqual(toolsetTableMismatches(fixture, 84), ['toolset table sums to 83, registry has 84']);
});

check('NEGATIVE: an ActualQL table with fewer rows than its heading is detected', () => {
  const fixture = '- **8 exclusive ActualQL-powered tools.** x\n\n**Exclusive ActualQL-powered (8)**, u\n\n| Tool | D |\n|---|---|\n'
    + Array.from({ length: 7 }, (_, i) => `| \`actual_t${i}\` | d |`).join('\n') + '\n';
  assert.deepStrictEqual(actualqlMismatches(fixture), ['ActualQL heading says 8, table has 7 rows']);
});

check('NEGATIVE: a later table under another heading is not summed into the toolset table', () => {
  const fixture = '### Reducing the tool surface\n\n| `a` | 40 |\n| `b` | 44 |\n\n## Other\n\n| `c` | 5 |\n';
  assert.deepStrictEqual(toolsetTableMismatches(fixture, 84), []);
});

check('NEGATIVE: a stale write-capable count is detected', () => {
  const fixture = '| `MCP_READ_ONLY` | x | No | `true` hides and refuses the 47 write-capable tools. |\n'
    + 'hides every write-capable tool (47 of the 84, including `actual_bank_sync`), leaving 37.';
  const bad = writeCountMismatches(fixture, 48, 84);
  assert.ok(bad.includes('write-capable count 47, WRITE_CAPABLE has 48'), `got ${JSON.stringify(bad)}`);
});

check('POSITIVE: consistent ActualQL, toolset and write fixtures are not flagged', () => {
  const ql = '- **8 exclusive ActualQL-powered tools.** x\n\n**Exclusive ActualQL-powered (8)**, u\n\n| Tool | D |\n|---|---|\n'
    + Array.from({ length: 8 }, (_, i) => `| \`actual_t${i}\` | d |`).join('\n') + '\n';
  assert.deepStrictEqual(actualqlMismatches(ql), []);
  assert.deepStrictEqual(toolsetTableMismatches('### Reducing the tool surface\n\n| `a` | 40 |\n| `b` | 44 |\n', 84), []);
  assert.deepStrictEqual(writeCountMismatches('the 48 write-capable tools; (48 of the 84, including `x`), leaving 36.', 48, 84), []);
});

console.log(`\n[readme-stats-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
