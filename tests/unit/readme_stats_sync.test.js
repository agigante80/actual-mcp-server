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
//   - TypeScript / MCP / Node badges  -> the DECLARED package.json ranges
//     (devDependencies.typescript, dependencies["@modelcontextprotocol/sdk"], engines.node)
//   - "up to N concurrent sessions"   -> the .default('N') literal of MAX_CONCURRENT_SESSIONS
//     in src/config.ts
//   - "N attempts, exponential backoff" -> DEFAULT_RETRY_ATTEMPTS in src/lib/constants.ts
//   - coverage claim                  -> de-hardcoded: the README must carry NO "NN% ... Actual
//     Budget API" literal (a rotting percentage), the gaps are reported by check:coverage.
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
  mcp: majorMinor(pkg.dependencies['@modelcontextprotocol/sdk']),       // "1.29"
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

  const mcp = readme.match(/badge\/MCP-([0-9.]+)-/);
  if (!mcp) out.push('MCP badge not found');
  else if (mcp[1] !== canon.mcp) out.push(`MCP badge ${mcp[1]} != package.json ${canon.mcp}`);

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
// found. The version-bearing badges use a hyphen ("TypeScript-6.0", "MCP-1.29"), and bare
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

console.log('\n[readme-stats-sync]');

const README = read('README.md');

check('TypeScript / MCP / Node badges match the declared package.json versions', () => {
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

// ----- NEGATIVE in-test fixtures: prove each comparator flags synthetic drift -----

check('NEGATIVE: a drifted TypeScript badge is detected by badgeMismatches', () => {
  const fixture = '[![TypeScript](https://img.shields.io/badge/TypeScript-4.0-blue)] '
    + '[![MCP](https://img.shields.io/badge/MCP-1.29-orange)] '
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
    'The `@actual-app/api` library downloads data. badge/TypeScript-6.0-blue badge/MCP-1.29-orange',
  );
  assert.deepStrictEqual(hits, [], `comparator must not false-positive on bare names/badges, got ${JSON.stringify(hits)}`);
});

console.log(`\n[readme-stats-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
