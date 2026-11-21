// tests/unit/coderabbit_config.test.js
//
// #693: .coderabbit.yaml keeps the CodeRabbit app an ADVISORY reviewer scoped to pull
// requests against develop: outside ones and, in the #715 trial, the maintainer's own, so
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
