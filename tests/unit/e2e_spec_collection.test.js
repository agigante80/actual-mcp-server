// tests/unit/e2e_spec_collection.test.js
//
// #382: every `tests/e2e/*.spec.ts` must be collected by at least one Playwright project.
//
// WHY THIS EXISTS. `tests/e2e/stdio.spec.ts` contained three real tests and was matched by
// no `testMatch` in either config, so it never executed once from the day it was added. It
// was not a near miss: it sat there while #366 removed `tests/e2e/suites/` for exactly the
// same defect, and while CLAUDE.md described it as live E2E coverage.
//
// Nothing could have caught it:
//   - Playwright documents no mechanism for reporting a spec file no project collects, and
//     does not warn. A file matched by nothing is simply absent from the run.
//   - `knip.json` declares `tests/e2e/**/*.spec.ts` as an ENTRY pattern, so knip treats
//     every spec as a reachable root by definition and the blocking dead-code gate
//     structurally cannot see this class.
//
// WHY A DEDICATED GUARD RATHER THAN NARROWING THE KNIP PATTERN, which was the first
// instinct and is recorded here so it is not re-litigated. Narrowing `knip.json` to the
// collected specs would work, but it reports "unused file", which reads as "delete this"
// rather than "no project collects this", and it produces a FALSE failure whenever someone
// adds a spec AND wires it up correctly, until knip.json is also edited. This guard has
// neither problem: it stays quiet when a spec is properly collected, and when it fires it
// names the actual fix.
//
// Run: node tests/unit/e2e_spec_collection.test.js

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIGS = ['playwright.config.ts', 'playwright.config.docker.ts'];
const SPEC_DIR = join(ROOT, 'tests', 'e2e');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

/**
 * Extract every `testMatch:` value from a config's SOURCE.
 *
 * Source-parsed rather than imported, because importing a .ts config from a plain-node test
 * would need a transpiler in the unit chain. Handles the two forms Playwright accepts here:
 * a regex literal and a quoted glob. Anything else is reported rather than ignored, so an
 * unparseable config can never make this guard silently vacuous.
 */
function testMatchers(configSrc, configName) {
  const matchers = [];
  const unparsed = [];
  for (const m of configSrc.matchAll(/testMatch:\s*([^,\n]+)/g)) {
    const raw = m[1].trim().replace(/,$/, '');
    const asRegex = raw.match(/^\/(.*)\/([gimsuy]*)$/);
    if (asRegex) {
      matchers.push(new RegExp(asRegex[1], asRegex[2]));
      continue;
    }
    const asString = raw.match(/^['"`](.*)['"`]$/);
    if (asString) {
      // Minimal glob support: ** and * to regex. Enough for the forms in use.
      const pattern = asString[1]
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/(?<!\.)\*/g, '[^/]*');
      matchers.push(new RegExp(pattern));
      continue;
    }
    unparsed.push(`${configName}: ${raw}`);
  }
  return { matchers, unparsed };
}

console.log('\n[e2e-spec-collection]');

const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.ts'));
const configs = CONFIGS.map((c) => ({ name: c, src: readFileSync(join(ROOT, c), 'utf8') }));

check('the spec set and the config set are both real (guards against a vacuous pass)', () => {
  assert.ok(specs.length >= 3, `expected at least 3 spec files in tests/e2e, found ${specs.length}`);
  assert.strictEqual(configs.length, 2, 'expected exactly two Playwright configs');
});

const all = configs.flatMap((c) => {
  const { matchers, unparsed } = testMatchers(c.src, c.name);
  return matchers.map((re) => ({ re, config: c.name, unparsed }));
});

check('every testMatch in both configs parsed (an unparsed one would hide an orphan)', () => {
  const unparsed = configs.flatMap((c) => testMatchers(c.src, c.name).unparsed);
  assert.strictEqual(unparsed.length, 0, `unparsed testMatch entries: ${unparsed.join(', ')}`);
});

check('at least one matcher was found (an empty set would match nothing and pass nothing)', () => {
  assert.ok(all.length >= 3, `expected at least 3 testMatch patterns across both configs, found ${all.length}`);
});

check('every tests/e2e/*.spec.ts is collected by at least one Playwright project', () => {
  const orphans = specs.filter((spec) => !all.some(({ re }) => re.test(`tests/e2e/${spec}`) || re.test(spec)));
  assert.strictEqual(
    orphans.length,
    0,
    `no Playwright project collects: ${orphans.join(', ')}.\n` +
      `      These files are SILENTLY INERT: Playwright does not warn, and knip treats every\n` +
      `      *.spec.ts as an entry root so the dead-code gate cannot see them either.\n` +
      `      Fix by adding a project with a matching testMatch in playwright.config.ts or\n` +
      `      playwright.config.docker.ts, by moving the assertions somewhere that runs (see\n` +
      `      tests/unit/entrypoint_invariants.test.js), or by deleting the file.`,
  );
});

// NEGATIVE fixture: prove the comparator catches an orphan rather than passing vacuously.
check('NEGATIVE: a spec matched by no pattern is detected and named', () => {
  const orphans = ['orphan.spec.ts'].filter(
    (spec) => !all.some(({ re }) => re.test(`tests/e2e/${spec}`) || re.test(spec)),
  );
  assert.deepStrictEqual(orphans, ['orphan.spec.ts'], 'guard must flag a spec no project collects');
});

console.log(`\n[e2e-spec-collection] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
