// tests/unit/e2e_spec_collection.test.js
//
// #382: every `tests/e2e/*.spec.ts` must be collected by at least one Playwright project.
// #384: and COLLECTED IS NOT RUN, so this file now checks both.
//
// The #384 defect in one sentence: a guard that says "collected" gets read as "runs". Had #382
// been fixed by adding a `stdio-tests` project rather than by moving the assertions into the unit
// chain, this guard would have gone green while the file still executed nowhere, which is the same
// defect one level up and with a guard actively certifying it.
//
// So the second check partitions every spec into RUNS-IN-CI or DECLARED-MANUAL. The set of
// projects CI actually runs is read from `tests/e2e/run-docker-e2e.sh`, which is where that truth
// lives (both workflows invoke `test:e2e:docker:full`, which is that script). Parsing one shell
// script is deliberate: the ticket weighed parsing workflow YAML and called it brittle, and it
// would be, because it couples this test to job names. The script is the narrow waist.
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

// RECURSIVE. Playwright's `testDir: './tests/e2e'` recurses, and the defect #366 removed
// lived at `tests/e2e/suites/*.ts`, one directory down. A top-level-only scan would be
// blind to exactly the failure class this guard exists for.
const specs = readdirSync(SPEC_DIR, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.spec.ts'));
const configs = CONFIGS.map((c) => ({ name: c, src: readFileSync(join(ROOT, c), 'utf8') }));

check('the spec set and the config set are both real (guards against a vacuous pass)', () => {
  // A floor of 1, not of today's count: the risk being guarded is an empty glob making
  // every check below pass over nothing. Deleting a spec file is a legitimate change and
  // must not fail here with a message about an arbitrary minimum.
  assert.ok(specs.length >= 1, `no *.spec.ts found under tests/e2e; the glob is wrong`);
  assert.strictEqual(configs.length, 2, 'expected exactly two Playwright configs');
});

// Parsed ONCE per config: calling the parser twice invited the two results to disagree.
const parsed = configs.map((c) => ({ name: c.name, ...testMatchers(c.src, c.name) }));
const all = parsed.flatMap((p) => p.matchers.map((re) => ({ re, config: p.name })));

check('every testMatch in both configs parsed (an unparsed one would hide an orphan)', () => {
  const unparsed = parsed.flatMap((p) => p.unparsed);
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

// #384: which project does CI ACTUALLY run?
//
// The first version of this got it wrong in a way worth recording, because it is the same mistake
// the ticket is about. It treated "defined in playwright.config.docker.ts" as "runs in CI", which
// made `docker.e2e.spec.ts` pass: the `docker-e2e-smoke` project is defined in that config and CI
// never selects it. A guard that accepts a project nobody invokes is the defect, not the fix.
//
// So the chain is followed end to end, through the two files where the truth actually lives:
//   workflows -> which `test:e2e:docker:<level>` script they run
//   run-docker-e2e.sh -> which PLAYWRIGHT_PROJECT that level selects
//   playwright.config.docker.ts -> which testMatch that project carries
const workflowDir = join(ROOT, '.github', 'workflows');
const workflowSrc = readdirSync(workflowDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => readFileSync(join(workflowDir, f), 'utf8'))
  .join('\n');
const ciLevels = [...new Set(
  [...workflowSrc.matchAll(/test:e2e:docker:([a-z]+)/g)].map((m) => m[1]),
)];

// The level-to-project mapping, read from the branch that assigns it.
const runnerSrc = readFileSync(join(ROOT, 'tests', 'e2e', 'run-docker-e2e.sh'), 'utf8');
const levelToProject = {};
{
  const m = runnerSrc.match(
    /if \[ "\$TEST_LEVEL" = "([a-z]+)" \][\s\S]*?PLAYWRIGHT_PROJECT="([A-Za-z0-9_-]+)"[\s\S]*?else[\s\S]*?PLAYWRIGHT_PROJECT="([A-Za-z0-9_-]+)"/,
  );
  if (m) {
    levelToProject[m[1]] = m[2];
    levelToProject.__else__ = m[3];
  }
}
const ciProjects = [...new Set(
  ciLevels.map((lvl) => levelToProject[lvl] ?? levelToProject.__else__).filter(Boolean),
)];

// project name -> testMatch, from the docker config only (the config the runner uses).
const dockerCfg = configs.find((c) => c.name === 'playwright.config.docker.ts').src;
const projectMatchers = new Map();
for (const m of dockerCfg.matchAll(/name:\s*['"`]([A-Za-z0-9_-]+)['"`],\s*\n\s*testMatch:\s*([^,\n]+)/g)) {
  const raw = m[2].trim().replace(/,$/, '');
  const asRegex = raw.match(/^\/(.*)\/([gimsuy]*)$/);
  if (asRegex) projectMatchers.set(m[1], new RegExp(asRegex[1], asRegex[2]));
}
const ciMatchers = ciProjects.map((p) => projectMatchers.get(p)).filter(Boolean);

// Specs that are DELIBERATELY not part of any gate. An entry here is a decision, not an
// oversight, and it must say what the file is for and where else its coverage lives.
const DECLARED_MANUAL = {
  'mcp-client.playwright.spec.ts':
    '#384: a manual protocol diagnostic, run with `npx playwright test --config playwright.config.ts ' +
    '--project=mcp-protocol-tests` against a running server. NOT a gate. Its round-trip coverage is ' +
    'duplicated by docker-all-tools.e2e.spec.ts (initialize plus tools/call across all 74 tools) and ' +
    'its expired-session shim assertions by tests/unit/httpServer_session_not_found.test.js. The only ' +
    'thing unique to it is the SSE connect, judged not worth a second Playwright project in the ' +
    'docker job. Wire it in if that judgement changes.',
  'docker.e2e.spec.ts':
    '#384: the SMOKE spec, selected only by `npm run test:e2e:docker:smoke`, which is a local ' +
    'fast check. CI runs the full level, so this file is NOT a gate. Every assertion it makes is ' +
    'also made by docker-all-tools.e2e.spec.ts, which is what CI runs.',
};

check('the CI chain resolved (an empty project set would make the next check vacuous)', () => {
  assert.ok(ciLevels.length >= 1, 'no test:e2e:docker:<level> invocation found in .github/workflows');
  assert.ok(ciProjects.length >= 1, `no project resolved for CI levels ${ciLevels.join(', ')}; the runner parse is stale`);
  assert.ok(ciMatchers.length >= 1, `no testMatch found for CI projects ${ciProjects.join(', ')}; the config parse is stale`);
});

check('every spec either RUNS in CI or is declared a manual diagnostic', () => {
  // The distinction #382's guard could not make. A project existing proves nothing: both
  // `mcp-protocol-tests` and `docker-e2e-smoke` exist and CI selects neither.
  const undeclared = specs.filter((spec) => {
    if (Object.hasOwn(DECLARED_MANUAL, spec)) return false;
    return !ciMatchers.some((re) => re.test(`tests/e2e/${spec}`) || re.test(spec));
  });
  assert.deepStrictEqual(
    undeclared, [],
    `these specs are collected by SOME project but by none that CI runs (${ciProjects.join(', ')}),\n` +
      `      and are not declared manual either, so they look like coverage and are not:\n` +
      `      ${undeclared.join(', ')}.\n` +
      `      Either put them in a project the runner selects, or add a DECLARED_MANUAL entry in\n` +
      `      this file saying what the file is for and where its coverage actually lives.`,
  );
});

check('every DECLARED_MANUAL entry names a spec that still exists', () => {
  // Otherwise the list rots into exemptions for files nobody can find.
  const ghosts = Object.keys(DECLARED_MANUAL).filter((f) => !specs.includes(f));
  assert.deepStrictEqual(ghosts, [], `declared manual but no such spec: ${ghosts.join(', ')}`);
});

check('NEGATIVE: a spec collected only by a project CI never runs is flagged', () => {
  // The exact shape #384 describes, and the shape the first version of this check missed.
  const pretend = 'not-declared.spec.ts';
  const undeclared = [pretend].filter(
    (spec) => !Object.hasOwn(DECLARED_MANUAL, spec)
      && !ciMatchers.some((re) => re.test(`tests/e2e/${spec}`) || re.test(spec)),
  );
  assert.deepStrictEqual(undeclared, [pretend], 'guard must flag a spec that no CI project runs');
});

check('NEGATIVE: the CI project set really excludes the smoke project', () => {
  // If this ever includes docker-e2e-smoke, the check above silently stops discriminating,
  // which is how the first version of it passed while proving nothing.
  assert.ok(
    !ciProjects.includes('docker-e2e-smoke'),
    `CI project set unexpectedly includes the smoke project: ${ciProjects.join(', ')}`,
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
