// tests/unit/config_drift.test.js
//
// #231: configuration single-source-of-truth guard. Canonical set = the Zod schema
// keys in src/config.ts united with RAW_ENV_ALLOWLIST in src/lib/config-registry.ts.
// This test enforces, in-process against the real compiled registry:
//   1. ENUMERATION: every process.env.X read in src/ is a schema key or an allowlist
//      name (no silently unaccounted raw read).
//   2. COVERAGE: every documented canonical var is in .env.example AND
//      docs/reference/configuration.md, and every documented var maps back to a
//      canonical/dynamic/OS var.
//   3. DRIFT (negative): a synthetic doc set missing a canonical var is detected.
//   4. DEFAULTS: configSchema.safeParse(requiredBase) succeeds with documented defaults.
//   5. #604: findDrift (scripts/config-drift.mjs) on string fixtures: the reference
//      parse, the README summary, and documented defaults against the Zod defaults.
//
// Run: node tests/unit/config_drift.test.js   (needs the dummy ACTUAL_* env, like the
// sibling config tests, because importing dist/src/config.js runs getConfig()).

import assert from 'assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const { configSchema } = await import('../../dist/src/config.js');
const registry = await import('../../dist/src/lib/config-registry.js');
const {
  parseReferenceTables,
  readmeSummaryVars,
  envExampleVars,
  schemaDefaults,
  findDrift,
} = await import('../../scripts/config-drift.mjs');
const {
  RAW_ENV_ALLOWLIST,
  SCHEMA_VARS_ALSO_READ_RAW,
  canonicalConfigVars,
  documentedConfigVars,
  DYNAMIC_ENV_FAMILIES,
  OS_LEVEL_ENV,
  isDynamicFamilyVar,
} = await import('../../dist/src/lib/config-registry.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[config-drift]');

// Schema keys come from the COMPILED schema itself (configSchema.shape is reachable
// in Zod v4 even after .refine), the same source the drift script uses. No brittle
// text parse, so an indentation change cannot silently drop a key.
const schemaKeys = Object.keys(configSchema.shape);
const allowNames = RAW_ENV_ALLOWLIST.map((v) => v.name);
const canonical = canonicalConfigVars(schemaKeys);
const mustDocument = documentedConfigVars(schemaKeys);

const isOs = (n) => OS_LEVEL_ENV.includes(n);
const accountedFor = (n) => canonical.has(n) || isDynamicFamilyVar(n) || isOs(n);

// Documented var names: .env.example (uncommented and commented), and every table of
// docs/reference/configuration.md (#604). The parsers are imported from the script
// itself, so the script and this test cannot drift apart again.
const REFERENCE = 'docs/reference/configuration.md';
const referenceMd = read(REFERENCE);
const readmeMd = read('README.md');
const envText = read('.env.example');
const envNames = envExampleVars(envText);
const referenceNames = new Set(parseReferenceTables(referenceMd).keys());

// Enumerate every env read across src/: the dotted form `process.env.X`, the bracket
// form `process.env['X']`, AND the indirect `env.X` alias form (a helper that takes
// `env: NodeJS.ProcessEnv`, e.g. logger.ts resolveLogConfig reading env.LOG_FORMAT).
// The lookbehind excludes `process.env.X` from the alias match so it is not counted
// twice. This closes the blind spot for a NEW indirect read added in that pattern.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}
const envReads = new Set();
const DIRECT_RE = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g;
const ALIAS_RE = /(?<!process\.)\benv\.([A-Z][A-Z0-9_]+)/g;
for (const file of walk(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(DIRECT_RE)) envReads.add(m[1] || m[2]);
  for (const m of src.matchAll(ALIAS_RE)) envReads.add(m[1]);
}

check('schema and allowlist names are disjoint (a var is not both)', () => {
  const overlap = allowNames.filter((n) => schemaKeys.includes(n));
  assert.strictEqual(overlap.length, 0, `allowlist overlaps schema: ${overlap.join(', ')}`);
});

check('ENUMERATION: every env read in src/ is schema, allowlist, or a dynamic family', () => {
  // accountedFor allows the dynamic BUDGET_ family (e.g. BUDGET_DEFAULT_NAME, read via
  // the env.X alias in budget-registry.ts) and OS-level vars, alongside canonical.
  const unaccounted = [...envReads].filter((n) => !accountedFor(n)).sort();
  assert.strictEqual(unaccounted.length, 0, `unaccounted env reads: ${unaccounted.join(', ')}`);
});

check('COVERAGE: every documented canonical var is in .env.example and the reference', () => {
  const missingEnv = [...mustDocument].filter((n) => !envNames.has(n)).sort();
  const missingRef = [...mustDocument].filter((n) => !referenceNames.has(n)).sort();
  assert.strictEqual(missingEnv.length, 0, `missing from .env.example: ${missingEnv.join(', ')}`);
  assert.strictEqual(missingRef.length, 0, `missing from ${REFERENCE}: ${missingRef.join(', ')}`);
});

check('COVERAGE: no documented var is unaccounted (canonical, dynamic, or OS)', () => {
  const strayEnv = [...envNames].filter((n) => !accountedFor(n)).sort();
  const strayRef = [...referenceNames].filter((n) => !accountedFor(n)).sort();
  assert.strictEqual(strayEnv.length, 0, `.env.example has unknown vars: ${strayEnv.join(', ')}`);
  assert.strictEqual(strayRef.length, 0, `${REFERENCE} has unknown vars: ${strayRef.join(', ')}`);
});

check('DRIFT (negative): removing a documented var from a doc set is detected', () => {
  // Exercise the SAME comparison the COVERAGE check and the script use
  // (mustDocument vs a documented set), against a doc set with one var removed.
  const target = [...mustDocument].find((n) => envNames.has(n));
  assert.ok(target, 'expected at least one documented var present in .env.example');
  const brokenEnv = new Set([...envNames].filter((n) => n !== target));
  const missing = [...mustDocument].filter((n) => !brokenEnv.has(n)).sort();
  assert.deepStrictEqual(missing, [target], `guard must flag exactly ${target}`);
});

check('SCHEMA_VARS_ALSO_READ_RAW entries are schema keys actually read raw', () => {
  for (const { name } of SCHEMA_VARS_ALSO_READ_RAW) {
    assert.ok(schemaKeys.includes(name), `${name} listed as schema-also-raw but is not a schema key`);
    assert.ok(envReads.has(name), `${name} listed as schema-also-raw but no process.env.${name} read found in src/`);
  }
});

check('DEFAULTS: safeParse(requiredBase) succeeds with documented defaults', () => {
  const base = {
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_PASSWORD: 'pw',
    ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
  };
  const r = configSchema.safeParse({ ...base });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_BRIDGE_PORT, '3600');
  assert.strictEqual(r.data.MCP_BRIDGE_DATA_DIR, './actual-data');
  assert.strictEqual(r.data.MCP_HTTP_BODY_LIMIT, '512kb');
  assert.strictEqual(r.data.MAX_CONCURRENT_SESSIONS, 15);
  assert.strictEqual(r.data.AUTH_PROVIDER, 'none');
});

// ---------------------------------------------------------------------------
// #604: findDrift against string fixtures. Each fixture is the real tree's file with
// ONE targeted edit, run with the real compiled configSchema and registry.
// ---------------------------------------------------------------------------
const drift = (over = {}) => findDrift({ referenceMd, readmeMd, envText, configSchema, registry, ...over });

/** Edit the row of `name` in a markdown string (null deletes it), asserting it exists. */
function editRow(md, name, fn) {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`| \`${name}\` |`));
  assert.ok(i !== -1, `fixture: no row for ${name}`);
  const replaced = fn(lines[i]);
  if (replaced === null) lines.splice(i, 1); else lines[i] = replaced;
  return lines.join('\n');
}
/** The reference with the MCP_BRIDGE_PORT Default cell set to `cell`. */
const withPortDefault = (cell) => editRow(referenceMd, 'MCP_BRIDGE_PORT', (l) => {
  assert.ok(l.includes('| port string | `3600` |'), 'fixture: MCP_BRIDGE_PORT row shape changed');
  return l.replace('| port string | `3600` |', `| port string | ${cell} |`);
});
const UNKNOWN_ROW = '| `MCP_NOT_A_VAR` | string | (none) | No | no | schema | config | not real |';

const EXPECTED_DEFAULT_KEYS = [
  'ACTUAL_EXPORT_DIR', 'ACTUAL_IMPORT_TIMEOUT_MS', 'ACTUAL_OP_TIMEOUT_MS', 'ACTUAL_PASSWORD',
  'AUTH_BUDGET_ACL_CLAIM', 'AUTH_BUDGET_ACL_IDENTITY_MAP', 'AUTH_BUDGET_ACL_IDENTITY_SOURCE',
  'AUTH_BUDGET_ACL_SOURCE', 'AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS', 'AUTH_PROVIDER',
  'MAX_CONCURRENT_SESSIONS', 'MCP_BRIDGE_DATA_DIR', 'MCP_BRIDGE_PORT', 'MCP_HTTP_BODY_LIMIT',
  'MCP_TOOLS', 'MCP_TOOLSETS', 'MCP_TRANSPORT_MODE', 'OIDC_TOKEN_SOURCE',
];

check('P1: findDrift on the unmodified tree reports nothing', () => {
  assert.deepStrictEqual(drift(), []);
});

check('P1: the CLI exits 0 and its success line names the reference and the defaults count', () => {
  const script = join(ROOT, 'scripts', 'config-drift.mjs');
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: process.env });
  assert.strictEqual(r.status, 0, `stdout: ${r.stdout} stderr: ${r.stderr}`);
  const k = schemaDefaults(configSchema).size;
  assert.ok(k > 0, 'schemaDefaults found no defaults');
  assert.ok(r.stdout.includes(`and ${REFERENCE}; ${k} defaults match.`), `stdout: ${r.stdout}`);
});

check('P2: schemaDefaults returns exactly the 18 defaulted keys and each matches the reference', () => {
  const defaults = schemaDefaults(configSchema);
  assert.deepStrictEqual([...defaults.keys()].sort(), EXPECTED_DEFAULT_KEYS);
  assert.strictEqual(defaults.get('MCP_BRIDGE_PORT'), '3600');
  const problems = drift().filter((p) => p.startsWith('Default mismatch') || p.startsWith('Unreadable default'));
  assert.deepStrictEqual(problems, []);
});

check("P3: (none), (empty) and a leading `''` token all normalise to the empty default", () => {
  const tables = parseReferenceTables(referenceMd);
  assert.strictEqual(tables.get('ACTUAL_PASSWORD'), '(none)');
  assert.strictEqual(tables.get('MCP_TOOLS'), '(empty)');
  assert.ok(tables.get('ACTUAL_EXPORT_DIR').startsWith("`''`, derived as"), tables.get('ACTUAL_EXPORT_DIR'));
  const defaults = schemaDefaults(configSchema);
  for (const n of ['ACTUAL_PASSWORD', 'MCP_TOOLS', 'ACTUAL_EXPORT_DIR']) assert.strictEqual(defaults.get(n), '');
  const problems = drift().filter((p) => /ACTUAL_PASSWORD|MCP_TOOLS|ACTUAL_EXPORT_DIR/.test(p));
  assert.deepStrictEqual(problems, []);
});

check('P4: every table shape is parsed, an escaped pipe does not shift the Default column', () => {
  const md = [
    '# Fixture',
    '',
    '| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |',
    '|----------|------|---------|----------|--------|--------|--------------|-------|',
    '| **A group row** ||||||||',
    '| `EIGHT_COL` | string | `eight` | No | no | schema | config | 8 columns |',
    '| `PIPE_TYPE` | `static` \\| `actual` | `pipe-default` | No | no | schema | config | escaped pipe in Type |',
    '',
    'Prose between tables.',
    '',
    '| Variable | Type | Default | Required | Secret | Source | Notes |',
    '|----------|------|---------|----------|--------|--------|-------|',
    '| `SEVEN_COL` | string | `seven` | No | no | dynamic | 7 columns |',
    '| `BUDGET_n_NAME` | string | (none) | No | no | dynamic | family row |',
    '',
    '| Variable | Default | Source | Notes |',
    '|----------|---------|--------|-------|',
    '| `OS_VAR` | `UTC` (host) | os | 4 columns |',
  ].join('\n');
  const map = parseReferenceTables(md);
  // PIPE_TYPE: a naive split would read "`actual`" (the second half of its Type cell).
  assert.deepStrictEqual([...map.entries()], [
    ['EIGHT_COL', '`eight`'],
    ['PIPE_TYPE', '`pipe-default`'],
    ['SEVEN_COL', '`seven`'],
    ['OS_VAR', '`UTC` (host)'],
  ]);
});

check('N1: a schema var missing from the reference is reported', () => {
  const md = editRow(referenceMd, 'MCP_BRIDGE_PORT', () => null);
  assert.deepStrictEqual(drift({ referenceMd: md }), [`Missing from ${REFERENCE}: MCP_BRIDGE_PORT`]);
});

check('N2: a schema var missing from .env.example is reported', () => {
  const lines = envText.split('\n');
  const before = lines.length;
  const kept = lines.filter((l) => !/^#?\s*MCP_BRIDGE_PORT=/.test(l));
  assert.ok(kept.length < before, 'fixture: no MCP_BRIDGE_PORT line in .env.example');
  assert.deepStrictEqual(drift({ envText: kept.join('\n') }), ['Missing from .env.example: MCP_BRIDGE_PORT']);
});

check('N3: an unknown var in the reference is reported', () => {
  const md = editRow(referenceMd, 'MCP_BRIDGE_PORT', (l) => `${l}\n${UNKNOWN_ROW}`);
  assert.deepStrictEqual(drift({ referenceMd: md }), [`In ${REFERENCE} but not a known config var: MCP_NOT_A_VAR`]);
});

check('N4: a documented default that differs from Zod is reported', () => {
  assert.deepStrictEqual(drift({ referenceMd: withPortDefault('`3700`') }),
    ['Default mismatch for MCP_BRIDGE_PORT: docs 3700, schema 3600']);
});

check('N5: an empty documented default against a non-empty Zod default is reported', () => {
  assert.deepStrictEqual(drift({ referenceMd: withPortDefault('(none)') }),
    ['Default mismatch for MCP_BRIDGE_PORT: docs (none), schema 3600']);
});

check('N6: a Default cell with no backticked token is unreadable', () => {
  assert.deepStrictEqual(drift({ referenceMd: withPortDefault('auto-detected') }),
    ['Unreadable default for MCP_BRIDGE_PORT: auto-detected']);
});

check('N7: an unknown var in the README summary is reported', () => {
  const md = readmeMd.replace('<!-- env-summary:end -->',
    '| `MCP_NOT_A_VAR` | No | not real |\n<!-- env-summary:end -->');
  assert.notStrictEqual(md, readmeMd, 'fixture: README has no env-summary end marker');
  assert.deepStrictEqual(drift({ readmeMd: md }), ['In README env table but not a known config var: MCP_NOT_A_VAR']);
});

check('N8: a removed README summary marker is reported, never a vacuous pass', () => {
  const md = readmeMd.replace('<!-- env-summary:start -->', '');
  assert.notStrictEqual(md, readmeMd, 'fixture: README has no env-summary start marker');
  assert.strictEqual(readmeSummaryVars(md), null);
  assert.deepStrictEqual(drift({ readmeMd: md }), ['README env summary markers not found']);
});

check('N13: a var documented in two rows is reported, even when the second default is right', () => {
  // Map.set kept only the last row, so a wrong 3700 followed by a right 3600 passed.
  const md = withPortDefault('`3700`') +
    '\n\n| Variable | Default |\n|---|---|\n| `MCP_BRIDGE_PORT` | `3600` |\n';
  assert.deepStrictEqual(drift({ referenceMd: md }),
    [`Documented more than once in ${REFERENCE}: MCP_BRIDGE_PORT`,
      'Default mismatch for MCP_BRIDGE_PORT: docs 3700, schema 3600']);
});

check('N14: a double-backtick code span is read whole, not as an empty token', () => {
  // ``3700`` renders as 3700; a single-backtick regex read its opening `` as ''.
  assert.deepStrictEqual(drift({ referenceMd: withPortDefault('``3700``') }),
    ['Default mismatch for MCP_BRIDGE_PORT: docs 3700, schema 3600']);
  assert.deepStrictEqual(drift({ referenceMd: withPortDefault('`` 3600 ``') }), []);
});

check('N15: table rows without leading pipes are still parsed (GFM allows them)', () => {
  const table = '\n\nVariable | Default\n--- | ---\n`MCP_NOT_A_VAR` | (none)\n';
  assert.deepStrictEqual(drift({ referenceMd: referenceMd + table }),
    [`In ${REFERENCE} but not a known config var: MCP_NOT_A_VAR`]);
  const md = readmeMd.replace('<!-- env-summary:end -->',
    '`MCP_NOT_A_VAR` | No | not real\n<!-- env-summary:end -->');
  assert.deepStrictEqual(drift({ readmeMd: md }), ['In README env table but not a known config var: MCP_NOT_A_VAR']);
});

check('N12: a schema whose defaults cannot be unwrapped fails loudly', () => {
  const stub = {
    shape: Object.fromEntries(Object.keys(configSchema.shape).map((k) => [k, { _zod: { def: { type: 'string' } } }])),
  };
  assert.deepStrictEqual(findDrift({ referenceMd, readmeMd, envText, configSchema: stub, registry }),
    ['No Zod defaults found in configSchema (zod def shape changed?)']);
});

check('sanity: dynamic families and OS-level lists are non-empty', () => {
  assert.ok(DYNAMIC_ENV_FAMILIES.length > 0 && OS_LEVEL_ENV.length > 0);
});

console.log(`\n[config-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
