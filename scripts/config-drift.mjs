#!/usr/bin/env node
/**
 * scripts/config-drift.mjs  (#231)
 *
 * Configuration drift guard. The canonical set of config variables = the Zod
 * schema keys in src/config.ts united with RAW_ENV_ALLOWLIST in
 * src/lib/config-registry.ts. This guard asserts:
 *
 *   1. Every DOCUMENTED canonical var (schema keys + allowlist entries not flagged
 *      `documented: false`) appears in BOTH .env.example and the README env table.
 *   2. Every documented var in .env.example / the README table maps back to a
 *      canonical var, a dynamic family (BUDGET_*), or an OS-level var (TZ); nothing
 *      is documented that the code does not actually understand.
 *
 * The registry data comes from the COMPILED module (dist/src/lib/config-registry.js),
 * the same source the unit test tests/unit/config_drift.test.js imports, so the two
 * enforcement paths can never disagree on the allowlist. Only the schema keys are
 * read from src/config.ts as text (the compiled configSchema is a ZodEffects after
 * .refine, so it has no .shape). Run `npm run build` first if dist is stale.
 *
 *   node scripts/config-drift.mjs            # --check (default): exit 1 on drift
 *   node scripts/config-drift.mjs --check
 *   node scripts/config-drift.mjs --fix      # append missing vars to .env.example as commented stubs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const mode = process.argv.includes('--fix') ? 'fix' : 'check';

let registry;
try {
  registry = await import('../dist/src/lib/config-registry.js');
} catch {
  console.error('config-drift: could not load dist/src/lib/config-registry.js. Run `npm run build` first.');
  process.exit(2);
}
const { canonicalConfigVars, documentedConfigVars, OS_LEVEL_ENV, isDynamicFamilyVar } = registry;

// Schema keys from src/config.ts (the flat z.object; configSchema is a ZodEffects).
const schemaKeys = [...read('src/config.ts').matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);

const canonical = canonicalConfigVars(schemaKeys);
const mustDocument = documentedConfigVars(schemaKeys);
const isOs = (n) => OS_LEVEL_ENV.includes(n);
const accountedFor = (n) => canonical.has(n) || isDynamicFamilyVar(n) || isOs(n);

// Documented var names in .env.example (uncommented and commented) and the README env table.
const envNames = new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const readmeNames = new Set([...read('README.md').matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]));

const missingFromEnv = [...mustDocument].filter((n) => !envNames.has(n)).sort();
const missingFromReadme = [...mustDocument].filter((n) => !readmeNames.has(n)).sort();
const unaccountedEnv = [...envNames].filter((n) => !accountedFor(n)).sort();
const unaccountedReadme = [...readmeNames].filter((n) => !accountedFor(n)).sort();

if (mode === 'fix') {
  if (missingFromEnv.length) {
    const stub =
      '\n# Added by config-drift --fix (#231): document or remove. See docs/CONFIGURATION.md.\n' +
      missingFromEnv.map((n) => `# ${n}=`).join('\n') +
      '\n';
    writeFileSync(join(ROOT, '.env.example'), read('.env.example').replace(/\n*$/, '\n') + stub);
    console.log(`config-drift --fix: appended ${missingFromEnv.length} stub(s) to .env.example: ${missingFromEnv.join(', ')}`);
  } else {
    console.log('config-drift --fix: nothing to add to .env.example.');
  }
  console.log('Note: --fix only seeds .env.example. README env table and docs/CONFIGURATION.md are edited by hand.');
  process.exit(0);
}

// --check
const problems = [];
if (missingFromEnv.length) problems.push(`Missing from .env.example: ${missingFromEnv.join(', ')}`);
if (missingFromReadme.length) problems.push(`Missing from README env table: ${missingFromReadme.join(', ')}`);
if (unaccountedEnv.length) problems.push(`In .env.example but not a known config var: ${unaccountedEnv.join(', ')}`);
if (unaccountedReadme.length) problems.push(`In README env table but not a known config var: ${unaccountedReadme.join(', ')}`);

if (problems.length) {
  console.error('Config drift detected:\n  ' + problems.join('\n  '));
  console.error('\nFix: document the var in .env.example and the README env table (and docs/CONFIGURATION.md),');
  console.error('or add it to RAW_ENV_ALLOWLIST / mark it documented:false in src/lib/config-registry.ts.');
  console.error('Run `node scripts/config-drift.mjs --fix` to seed missing .env.example stubs.');
  process.exit(1);
}
console.log(`No config drift. ${mustDocument.size} documented vars consistent across schema, allowlist, .env.example, and README.`);
