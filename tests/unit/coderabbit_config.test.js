// tests/unit/coderabbit_config.test.js
//
// #693: .coderabbit.yaml keeps the CodeRabbit app an ADVISORY reviewer scoped to outside
// pull requests against develop. The keys pinned here are the ones whose schema DEFAULT
// would break a project rule if the line were dropped: only the default branch is reviewed
// without base_branches, bot pull requests are reviewed without ignore_usernames, and issue
// planning is ON by default (ticket comments here are messages between people only).
//
// Run: node tests/unit/coderabbit_config.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOTS = ['dependabot[bot]', 'actual-mcp-dependency-updater[bot]'];
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
  if (cfg?.reviews?.fail_commit_status !== false) fail('fail_commit_status must be false');
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
refuses('a failing commit status', (c) => { c.reviews.fail_commit_status = true; },
  'coderabbit config: fail_commit_status must be false');
refuses('an over-long tone', (c) => { c.tone_instructions = 'x'.repeat(TONE_MAX + 1); },
  `coderabbit config: tone_instructions exceeds ${TONE_MAX} characters`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
