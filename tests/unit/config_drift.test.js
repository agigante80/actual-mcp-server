// tests/unit/config_drift.test.js
//
// #231: configuration single-source-of-truth guard. Canonical set = the Zod schema
// keys in src/config.ts united with RAW_ENV_ALLOWLIST in src/lib/config-registry.ts.
// This test enforces, in-process against the real compiled registry:
//   1. ENUMERATION: every process.env.X read in src/ is a schema key or an allowlist
//      name (no silently unaccounted raw read).
//   2. COVERAGE: every documented canonical var is in .env.example AND the README env
//      table, and every documented var maps back to a canonical/dynamic/OS var.
//   3. DRIFT (negative): a synthetic doc set missing a canonical var is detected.
//   4. DEFAULTS: configSchema.safeParse(requiredBase) succeeds with documented defaults.
//
// Run: node tests/unit/config_drift.test.js   (needs the dummy ACTUAL_* env, like the
// sibling config tests, because importing dist/src/config.js runs getConfig()).

import assert from 'assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const { configSchema } = await import('../../dist/src/config.js');
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

// Schema keys from src/config.ts text (configSchema is a ZodEffects after .refine,
// so it has no .shape; the flat z.object keys are the source of truth).
const schemaKeys = [...read('src/config.ts').matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
const allowNames = RAW_ENV_ALLOWLIST.map((v) => v.name);
const canonical = canonicalConfigVars(schemaKeys);
const mustDocument = documentedConfigVars(schemaKeys);

const isOs = (n) => OS_LEVEL_ENV.includes(n);
const accountedFor = (n) => canonical.has(n) || isDynamicFamilyVar(n) || isOs(n);

// Parse the documented var names.
const envNames = new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const readmeNames = new Set([...read('README.md').matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]));

// Enumerate every process.env.X read across src/.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}
// Catches the dotted form `process.env.X` and the bracket form `process.env['X']`.
// Indirect reads via a helper that takes `env: NodeJS.ProcessEnv` (e.g.
// logger.ts resolveLogConfig reading `env.LOG_FORMAT`) are not matched here; those
// vars are covered by the allowlist instead. The enumeration's job is to catch a
// NEW direct process.env read that nobody added to the schema or the allowlist.
const envReads = new Set();
const ENV_READ_RE = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g;
for (const file of walk(join(ROOT, 'src'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(ENV_READ_RE)) envReads.add(m[1] || m[2]);
}

check('schema and allowlist names are disjoint (a var is not both)', () => {
  const overlap = allowNames.filter((n) => schemaKeys.includes(n));
  assert.strictEqual(overlap.length, 0, `allowlist overlaps schema: ${overlap.join(', ')}`);
});

check('ENUMERATION: every process.env.X read in src/ is schema or allowlist', () => {
  const unaccounted = [...envReads].filter((n) => !canonical.has(n)).sort();
  assert.strictEqual(unaccounted.length, 0, `unaccounted process.env reads: ${unaccounted.join(', ')}`);
});

check('COVERAGE: every documented canonical var is in .env.example and README', () => {
  const missingEnv = [...mustDocument].filter((n) => !envNames.has(n)).sort();
  const missingReadme = [...mustDocument].filter((n) => !readmeNames.has(n)).sort();
  assert.strictEqual(missingEnv.length, 0, `missing from .env.example: ${missingEnv.join(', ')}`);
  assert.strictEqual(missingReadme.length, 0, `missing from README: ${missingReadme.join(', ')}`);
});

check('COVERAGE: no documented var is unaccounted (canonical, dynamic, or OS)', () => {
  const strayEnv = [...envNames].filter((n) => !accountedFor(n)).sort();
  const strayReadme = [...readmeNames].filter((n) => !accountedFor(n)).sort();
  assert.strictEqual(strayEnv.length, 0, `.env.example has unknown vars: ${strayEnv.join(', ')}`);
  assert.strictEqual(strayReadme.length, 0, `README has unknown vars: ${strayReadme.join(', ')}`);
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

check('sanity: dynamic families and OS-level lists are non-empty', () => {
  assert.ok(DYNAMIC_ENV_FAMILIES.length > 0 && OS_LEVEL_ENV.length > 0);
});

console.log(`\n[config-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
