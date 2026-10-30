#!/usr/bin/env node
/**
 * scripts/config-drift.mjs  (#231, retargeted by #604)
 *
 * Configuration drift guard. The canonical set of config variables = the Zod
 * schema keys in src/config.ts united with RAW_ENV_ALLOWLIST in
 * src/lib/config-registry.ts. This guard asserts:
 *
 *   1. Every DOCUMENTED canonical var (schema keys + allowlist entries not flagged
 *      `documented: false`) appears in BOTH .env.example and
 *      docs/reference/configuration.md, the only env inventory.
 *   2. Every var in .env.example, the reference, or the README env summary maps back
 *      to a canonical var, a dynamic family (BUDGET_*), or an OS-level var (TZ);
 *      nothing is documented that the code does not actually understand.
 *   3. Every Zod default in the schema equals the Default cell the reference shows
 *      for it (see normaliseDefaultCell for the cell convention).
 *   4. The README env summary markers exist, so the README check cannot pass
 *      vacuously.
 *
 * Both the schema keys and the registry come from the COMPILED modules under dist/,
 * the same source the unit test tests/unit/config_drift.test.js imports, so the two
 * enforcement paths can never disagree. Run `npm run config-drift` (which builds
 * first) rather than invoking this file against a stale dist.
 *
 * The comparison logic is exported as pure functions (the unit test feeds them
 * strings); the CLI below runs only when this file is executed directly.
 *
 *   node scripts/config-drift.mjs              # --check (default): exit 1 on drift
 *   node scripts/config-drift.mjs --check
 *   node scripts/config-drift.mjs --root <dir> # read dist/ and the docs under <dir>
 *   node scripts/config-drift.mjs --fix        # append missing vars to .env.example as commented stubs
 *
 * Exit codes: 0 clean, 1 drift, 2 compiled modules not loadable under <root>/dist.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REFERENCE_PATH = 'docs/reference/configuration.md';
const SUMMARY_START = '<!-- env-summary:start -->';
const SUMMARY_END = '<!-- env-summary:end -->';
const NAME_CELL = /^`([A-Z][A-Z0-9_]+)`$/;

/** Split a markdown table row on UNESCAPED pipes, without the outer pipes. */
function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

/**
 * Every table of the reference: Map<name, Default cell>. A `| Variable | ... |`
 * header row sets the Default column for the rows below it; a data row counts when
 * its first cell is exactly a backticked uppercase name, so separator, group,
 * `BUDGET_n_*` and `MCP_TOKEN_*` rows never match. A non-table line ends a table.
 */
export function parseReferenceTables(md) {
  const out = new Map();
  let defaultIdx = -1;
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) { defaultIdx = -1; continue; }
    const cells = splitRow(line);
    if (cells[0] === 'Variable') { defaultIdx = cells.indexOf('Default'); continue; }
    const m = cells[0].match(NAME_CELL);
    if (!m) continue;
    out.set(m[1], defaultIdx >= 0 ? (cells[defaultIdx] ?? '') : '');
  }
  return out;
}

/** Names in the README env summary (between the markers), or null when a marker is missing. */
export function readmeSummaryVars(md) {
  const start = md.indexOf(SUMMARY_START);
  const end = md.indexOf(SUMMARY_END);
  if (start === -1 || end === -1 || end < start) return null;
  const names = new Set();
  for (const line of md.slice(start + SUMMARY_START.length, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = splitRow(line)[0].match(NAME_CELL);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Names in .env.example, uncommented and commented `KEY=` lines alike. */
export function envExampleVars(text) {
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

/**
 * Map<key, String(default)> for every schema key with a Zod default. Walks each
 * def through `in` (a zod v4 pipe, which `.transform` produces) and `innerType`
 * until a `default` node. Refinements are checks in zod v4, not wrappers.
 */
export function schemaDefaults(configSchema) {
  const out = new Map();
  for (const [key, field] of Object.entries(configSchema.shape)) {
    let def = field?._zod?.def;
    while (def) {
      if (def.type === 'default') {
        const v = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
        out.set(key, String(v));
        break;
      }
      def = (def.in ?? def.innerType)?._zod?.def;
    }
  }
  return out;
}

/**
 * The Default-cell convention: `(none)` and `(empty)` mean ''; otherwise the value is
 * the content of the FIRST backticked token, and a first token of `''` means ''.
 * Returns null when the cell has neither (unreadable).
 */
function normaliseDefaultCell(cell) {
  if (cell === '(none)' || cell === '(empty)') return '';
  const m = cell.match(/`([^`]*)`/);
  if (!m) return null;
  return m[1] === "''" ? '' : m[1];
}

const show = (v) => (v === '' ? '(none)' : v);

/** Every drift problem, one line each. Empty when the docs and the code agree. */
export function findDrift({ referenceMd, readmeMd, envText, configSchema, registry }) {
  const { canonicalConfigVars, documentedConfigVars, OS_LEVEL_ENV, isDynamicFamilyVar } = registry;
  const schemaKeys = Object.keys(configSchema.shape);
  const canonical = canonicalConfigVars(schemaKeys);
  const mustDocument = documentedConfigVars(schemaKeys);
  const accountedFor = (n) => canonical.has(n) || isDynamicFamilyVar(n) || OS_LEVEL_ENV.includes(n);

  const envNames = envExampleVars(envText);
  const reference = parseReferenceTables(referenceMd);
  const readmeNames = readmeSummaryVars(readmeMd);

  const list = (names) => [...names].sort().join(', ');
  const missing = (names) => [...mustDocument].filter((n) => !names.has(n));
  const stray = (names) => [...names].filter((n) => !accountedFor(n));

  const problems = [];
  const missingEnv = missing(envNames);
  const strayEnv = stray(envNames);
  const missingRef = missing(new Set(reference.keys()));
  const strayRef = stray(reference.keys());
  if (missingEnv.length) problems.push(`Missing from .env.example: ${list(missingEnv)}`);
  if (strayEnv.length) problems.push(`In .env.example but not a known config var: ${list(strayEnv)}`);
  if (missingRef.length) problems.push(`Missing from ${REFERENCE_PATH}: ${list(missingRef)}`);
  if (strayRef.length) problems.push(`In ${REFERENCE_PATH} but not a known config var: ${list(strayRef)}`);

  const defaults = schemaDefaults(configSchema);
  for (const [name, schemaValue] of [...defaults].sort(([a], [b]) => a.localeCompare(b))) {
    if (!reference.has(name)) continue; // already reported as missing
    const cell = reference.get(name);
    const docs = normaliseDefaultCell(cell);
    if (docs === null) problems.push(`Unreadable default for ${name}: ${cell}`);
    else if (docs !== schemaValue) problems.push(`Default mismatch for ${name}: docs ${show(docs)}, schema ${show(schemaValue)}`);
  }

  if (readmeNames === null) {
    problems.push('README env summary markers not found');
  } else {
    const strayReadme = stray(readmeNames);
    if (strayReadme.length) problems.push(`In README env table but not a known config var: ${list(strayReadme)}`);
  }
  if (defaults.size === 0) problems.push('No Zod defaults found in configSchema (zod def shape changed?)');
  return problems;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Through realpath: the repo is reachable through a symlink on the maintainer machine. */
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  }
}

async function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx !== -1 && argv[rootIdx + 1]
    ? resolve(argv[rootIdx + 1])
    : join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const mode = argv.includes('--fix') ? 'fix' : 'check';

  // Dummy required env so importing the compiled config (which validates process.env
  // at module load) does not exit; real values, if present, win.
  process.env.ACTUAL_SERVER_URL ||= 'http://localhost:5006';
  process.env.ACTUAL_PASSWORD ??= '';
  process.env.ACTUAL_BUDGET_SYNC_ID ||= '00000000-0000-0000-0000-000000000000';

  let configMod, registry;
  try {
    configMod = await import(pathToFileURL(join(root, 'dist/src/config.js')).href);
    registry = await import(pathToFileURL(join(root, 'dist/src/lib/config-registry.js')).href);
  } catch {
    console.error(`config-drift: could not load compiled modules under ${join(root, 'dist')}. Run \`npm run build\` first.`);
    return 2;
  }

  if (mode === 'fix') {
    const mustDocument = registry.documentedConfigVars(Object.keys(configMod.configSchema.shape));
    const envNames = envExampleVars(read('.env.example'));
    const missingFromEnv = [...mustDocument].filter((n) => !envNames.has(n)).sort();
    if (missingFromEnv.length) {
      const stub =
        `\n# Added by config-drift --fix (#231): document or remove. See ${REFERENCE_PATH}.\n` +
        missingFromEnv.map((n) => `# ${n}=`).join('\n') +
        '\n';
      writeFileSync(join(root, '.env.example'), read('.env.example').replace(/\n*$/, '\n') + stub);
      console.log(`config-drift --fix: appended ${missingFromEnv.length} stub(s) to .env.example: ${missingFromEnv.join(', ')}`);
    } else {
      console.log('config-drift --fix: nothing to add to .env.example.');
    }
    console.log(`Note: --fix only seeds .env.example. ${REFERENCE_PATH} and the README env summary are edited by hand.`);
    return 0;
  }

  const problems = findDrift({
    referenceMd: read(REFERENCE_PATH),
    readmeMd: read('README.md'),
    envText: read('.env.example'),
    configSchema: configMod.configSchema,
    registry,
  });
  if (problems.length) {
    console.error('Config drift detected:\n  ' + problems.join('\n  '));
    console.error(`\nFix: document the var in .env.example and ${REFERENCE_PATH} (its Default cell must`);
    console.error('match the Zod default), or add it to RAW_ENV_ALLOWLIST / mark it documented:false in');
    console.error('src/lib/config-registry.ts. Run `node scripts/config-drift.mjs --fix` to seed missing .env.example stubs.');
    return 1;
  }
  const documented = registry.documentedConfigVars(Object.keys(configMod.configSchema.shape)).size;
  const k = schemaDefaults(configMod.configSchema).size;
  console.log(`No config drift. ${documented} documented vars consistent across schema, allowlist, .env.example, and ${REFERENCE_PATH}; ${k} defaults match.`);
  return 0;
}

if (isDirectRun()) process.exit(await main(process.argv.slice(2)));
