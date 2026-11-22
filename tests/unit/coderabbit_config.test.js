// tests/unit/coderabbit_config.test.js
//
// #693: .coderabbit.yaml keeps the CodeRabbit app an ADVISORY reviewer scoped to pull
// requests against develop: outside ones and, since the #715 trial (ADR 0002), the maintainer's own, so
// ignore_usernames must hold the two bots and nobody else. The keys pinned here are the ones whose schema DEFAULT
// would break a project rule if the line were dropped: only the default branch is reviewed
// without base_branches, bot pull requests are reviewed without ignore_usernames, and issue
// planning is ON by default (ticket comments here are messages between people only), and
// five finishing touches that can PUSH a commit or a branch into the repository are ON by
// default (a pushed branch runs workflows from that branch).
//
// Run: node tests/unit/coderabbit_config.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOTS = ['dependabot[bot]', 'actual-mcp-dependency-updater[bot]'];
const NO_PUSH = ['unit_tests', 'autofix', 'fix_ci', 'resolve_merge_conflict', 'simplify'];
// The AGENTS.md heading each custom check's instructions name; both must exist there.
const TEST_REVIEW_HEADING = "What a review of a change's tests checks";
const DOCS_HEADING = 'Docs to update with a change';
const TESTS_CHECK = 'Tests cover the change';
const DOCS_CHECK = 'Docs cover the change';
// #727: checks are looked up by NAME, never by position, so reordering the list is free.
const CHECK_HEADINGS = { [TESTS_CHECK]: TEST_REVIEW_HEADING, [DOCS_CHECK]: DOCS_HEADING };
const TONE_MAX = 250; // schema maxLength for tone_instructions
// Built from code points so this file carries neither character itself.
const DASHES = [0x2013, 0x2014].map((c) => String.fromCharCode(c));

function fail(msg) { throw new Error(`coderabbit config: ${msg}`); }

export function checkConfig(cfg) {
  const auto = cfg?.reviews?.auto_review ?? {};
  if (!Array.isArray(auto.base_branches) || !auto.base_branches.includes('^develop$')) {
    fail('base_branches must contain ^develop$');
  }
  for (const bot of BOTS) {
    if (!Array.isArray(auto.ignore_usernames) || !auto.ignore_usernames.includes(bot)) {
      fail(`ignore_usernames must contain ${bot}`);
    }
  }
  // #715: anyone else here (the maintainer, say) silently loses their review. Order is free;
  // a duplicate fails, because the length then differs from the two bots.
  if (auto.ignore_usernames.length !== BOTS.length) fail('ignore_usernames must hold only the two bots');
  if (cfg?.reviews?.fail_commit_status !== false) fail('reviews.fail_commit_status must be false');
  if (cfg?.reviews?.auto_apply_labels !== false) fail('auto_apply_labels must be false');
  if (cfg?.issue_enrichment?.auto_enrich?.enabled !== false) {
    fail('issue_enrichment.auto_enrich.enabled must be false');
  }
  if (cfg?.issue_enrichment?.planning?.enabled !== false) {
    fail('issue_enrichment.planning.enabled must be false');
  }
  if (cfg?.issue_enrichment?.planning?.auto_planning?.enabled !== false) {
    fail('issue_enrichment.planning.auto_planning.enabled must be false');
  }
  for (const touch of NO_PUSH) {
    if (cfg?.reviews?.finishing_touches?.[touch]?.enabled !== false) {
      fail(`reviews.finishing_touches.${touch}.enabled must be false`);
    }
  }
  if (cfg?.reviews?.auto_approvals?.enabled !== false) fail('reviews.auto_approvals.enabled must be false');
  if (cfg?.reviews?.auto_approvals?.allow_author_approval !== false) {
    fail('reviews.auto_approvals.allow_author_approval must be false');
  }
  // The design relies on the app reading AGENTS.md; no copy of the rules lives in the config.
  if (cfg?.knowledge_base?.code_guidelines?.enabled === false) {
    fail('knowledge_base.code_guidelines.enabled must not be false');
  }
  if ((cfg?.reviews?.path_instructions ?? []).length) {
    fail('reviews.path_instructions must stay empty (AGENTS.md is the one source)');
  }
  // Two custom pre-merge checks, advisory: `error` mode can block a merge, and the criteria
  // live in AGENTS.md, so the instructions must point there instead of copying them.
  // Order of the tests: count and names first, then per check its mode, then its pointer.
  const pre = cfg?.reviews?.pre_merge_checks ?? {};
  const checks = pre.custom_checks ?? [];
  const names = Object.keys(CHECK_HEADINGS);
  const byName = (name) => checks.filter((c) => c?.name === name);
  if (checks.length !== names.length || !names.every((n) => byName(n).length === 1)) {
    fail('pre_merge_checks.custom_checks must hold exactly the two checks');
  }
  for (const name of names) {
    const [c] = byName(name);
    if (c.mode !== 'warning') fail(`the custom check ${name} must be in warning mode`);
    if (!String(c.instructions ?? '').includes(CHECK_HEADINGS[name])) {
      fail(`the custom check ${name} must point at its AGENTS.md list`);
    }
  }
  // The docs check applies the AGENTS.md section as it stands. These two phrases keep it from
  // growing a pass condition of its own (an unconditioned row applies whenever the change is
  // of that kind). They are a text guard only: instructions that keep both phrases and add an
  // exemption beside them still pass here, so the wording itself is reviewed by a person.
  const docs = String(byName(DOCS_CHECK)[0].instructions);
  if (!docs.includes('as written') || !docs.includes('applies whenever')) {
    fail(`the custom check ${DOCS_CHECK} must apply the AGENTS.md section as written`);
  }
  // A rough check for a copied table row: it sees a docs/ path, not a copied README or
  // .env.example row.
  if (docs.includes('docs/')) fail(`the custom check ${DOCS_CHECK} must not copy a doc path`);
  if (pre.override_requested_reviewers_only === true) {
    fail('pre_merge_checks.override_requested_reviewers_only must not be true');
  }
  for (const builtin of ['title', 'description', 'issue_assessment']) {
    if (pre[builtin]?.mode === 'error') fail(`pre_merge_checks.${builtin}.mode must not be error`);
  }
  const tone = cfg?.tone_instructions ?? '';
  if (tone.length > TONE_MAX) fail(`tone_instructions exceeds ${TONE_MAX} characters`);
}

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const raw = readFileSync(join(ROOT, '.coderabbit.yaml'), 'utf8');
const load = () => parse(raw);

console.log('coderabbit_config');
check('the committed config passes', () => checkConfig(load()));
check('no em or en dash in the config', () => {
  assert.ok(!DASHES.some((d) => raw.includes(d)), 'dash found in .coderabbit.yaml');
});

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
check('AGENTS.md carries the list the tests check points at', () => {
  assert.ok(agents.includes(TEST_REVIEW_HEADING), 'heading missing from AGENTS.md');
});
check('AGENTS.md carries the section the docs check points at, as a heading line', () => {
  assert.ok(agents.split('\n').includes(`## ${DOCS_HEADING}`), 'section heading missing from AGENTS.md');
});

const refuses = (label, mutate, message) => check(`negative: ${label}`, () => {
  const cfg = load();
  mutate(cfg);
  assert.throws(() => checkConfig(cfg), { message });
});
refuses('issue planning switched on', (c) => { c.issue_enrichment.planning.enabled = true; },
  'coderabbit config: issue_enrichment.planning.enabled must be false');
refuses('issue planning key dropped (schema default is on)', (c) => { delete c.issue_enrichment.planning; },
  'coderabbit config: issue_enrichment.planning.enabled must be false');
refuses('no develop base branch', (c) => { c.reviews.auto_review.base_branches = []; },
  'coderabbit config: base_branches must contain ^develop$');
refuses('a bot login removed', (c) => { c.reviews.auto_review.ignore_usernames = ['dependabot[bot]']; },
  'coderabbit config: ignore_usernames must contain actual-mcp-dependency-updater[bot]');
refuses('the maintainer excluded from review', (c) => { c.reviews.auto_review.ignore_usernames.push('agigante80'); },
  'coderabbit config: ignore_usernames must hold only the two bots');
refuses('a failing commit status', (c) => { c.reviews.fail_commit_status = true; },
  'coderabbit config: reviews.fail_commit_status must be false');
refuses('a finishing touch that pushes commits', (c) => { c.reviews.finishing_touches.autofix.enabled = true; },
  'coderabbit config: reviews.finishing_touches.autofix.enabled must be false');
refuses('finishing touches dropped (schema default is on)', (c) => { delete c.reviews.finishing_touches; },
  'coderabbit config: reviews.finishing_touches.unit_tests.enabled must be false');
refuses('author approval allowed', (c) => { c.reviews.auto_approvals.allow_author_approval = true; },
  'coderabbit config: reviews.auto_approvals.allow_author_approval must be false');
refuses('guideline reading switched off', (c) => { c.knowledge_base.code_guidelines.enabled = false; },
  'coderabbit config: knowledge_base.code_guidelines.enabled must not be false');
refuses('a rule copy in path_instructions', (c) => { c.reviews.path_instructions = [{ path: 'src/**', instructions: 'x' }]; },
  'coderabbit config: reviews.path_instructions must stay empty (AGENTS.md is the one source)');
refuses('an over-long tone', (c) => { c.tone_instructions = 'x'.repeat(TONE_MAX + 1); },
  `coderabbit config: tone_instructions exceeds ${TONE_MAX} characters`);
const custom = (c, name) => c.reviews.pre_merge_checks.custom_checks.find((k) => k.name === name);
const TWO = 'coderabbit config: pre_merge_checks.custom_checks must hold exactly the two checks';
refuses('the tests check in error mode', (c) => { custom(c, TESTS_CHECK).mode = 'error'; },
  `coderabbit config: the custom check ${TESTS_CHECK} must be in warning mode`);
refuses('the tests check mode dropped', (c) => { delete custom(c, TESTS_CHECK).mode; },
  `coderabbit config: the custom check ${TESTS_CHECK} must be in warning mode`);
refuses('the docs check mode dropped', (c) => { delete custom(c, DOCS_CHECK).mode; },
  `coderabbit config: the custom check ${DOCS_CHECK} must be in warning mode`);
refuses('a third custom check', (c) => { c.reviews.pre_merge_checks.custom_checks.push({ name: 'x', mode: 'warning', instructions: 'x' }); }, TWO);
refuses('the custom checks removed', (c) => { delete c.reviews.pre_merge_checks; }, TWO);
refuses('one of the pair renamed', (c) => { custom(c, DOCS_CHECK).name = 'Docs'; }, TWO);
refuses('one name twice', (c) => { custom(c, DOCS_CHECK).name = TESTS_CHECK; }, TWO);
refuses('test criteria copied instead of pointing at AGENTS.md', (c) => { custom(c, TESTS_CHECK).instructions = 'Every src change needs a test.'; },
  `coderabbit config: the custom check ${TESTS_CHECK} must point at its AGENTS.md list`);
refuses('the docs check losing the unconditioned-row sentence', (c) => {
  const k = custom(c, DOCS_CHECK);
  k.instructions = k.instructions.replace(/A row with no condition of its own applies whenever[^.]*\. /, '');
}, `coderabbit config: the custom check ${DOCS_CHECK} must apply the AGENTS.md section as written`);
refuses('a doc path copied into the docs check', (c) => { custom(c, DOCS_CHECK).instructions += ' docs/guides/deployment.md'; },
  `coderabbit config: the custom check ${DOCS_CHECK} must not copy a doc path`);
check('the custom checks pass in either order', () => {
  const cfg = load();
  cfg.reviews.pre_merge_checks.custom_checks.reverse();
  checkConfig(cfg);
});
refuses('a built-in check in error mode', (c) => { c.reviews.pre_merge_checks.title = { mode: 'error' }; },
  'coderabbit config: pre_merge_checks.title.mode must not be error');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
