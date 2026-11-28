#!/usr/bin/env node
// scripts/check-coderabbit-applied.mjs
//
// #851: did the CodeRabbit app APPLY .coderabbit.yaml on a pull request? A file the app
// rejects is dropped whole and vendor defaults apply (four finishing touches that push
// included), and no static check of the file can see that. tests/unit/coderabbit_config.test.js
// pins what the file says; this reads what the app says it used.
//
// Every review run carries a "Run configuration" block naming the file, the commit it was
// read at and the layers in force. On pull request 850 it sits in the bot's Walkthrough
// ISSUE comment (edited in place on each push) and the pull request had no review at all,
// so both sources are read. The check is positive: the block must name .coderabbit.yaml at
// the head commit with Layers exactly "Repository YAML"; a missing warning is not enough.
//
// Usage: node scripts/check-coderabbit-applied.mjs <pull request number>, run inside the
// checkout: gh resolves the repository from the current directory's GitHub remote.
// Exit: 0 pass, 1 problems found or no bot text yet, 2 usage, 3 a gh call failed.
// Manual on purpose: the block only exists after the app reviewed, so a pull request that
// changes .coderabbit.yaml runs this before it merges (docs/development/testing-and-reliability.md).

import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const BOT = 'coderabbitai[bot]';
const EXPECTED_FILE = '.coderabbit.yaml';
const EXPECTED_LAYERS = 'Repository YAML';
const HEADING = 'Run configuration';

// `- **Name**: value`, the value read as its link text when written `[text](<url>)`.
function readFields(block) {
  const fields = new Map();
  for (const line of block.split('\n')) {
    const m = /^\s*-\s+\*\*([^*]+)\*\*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const link = /^\[([^\]]*)\]\(/.exec(m[2]);
    fields.set(m[1].trim().toLowerCase(), link ? link[1].trim() : m[2]);
  }
  return fields;
}

// Each occurrence of the heading opens a candidate block up to the next </details>. The first
// that carries all of File, Commit and Layers wins, so the phrase in earlier prose cannot hide
// the real block; when none does, the last is returned so its missing fields are reported.
function findBlock(body) {
  let last = null;
  for (let at = body.indexOf(HEADING); at !== -1; at = body.indexOf(HEADING, at + 1)) {
    const end = body.indexOf('</details>', at);
    const fields = readFields(body.slice(at, end === -1 ? undefined : end));
    if (['file', 'commit', 'layers'].every((f) => fields.has(f))) return fields;
    last = fields;
  }
  return last;
}

// The problems with one bot text, in the order of the ticket's table; an empty list passes.
export function checkApplied(text, expectedSha) {
  const problems = [];
  const body = String(text ?? '');
  if (/has a parsing error/i.test(body)) problems.push('parsing error reported by the app');
  const fields = findBlock(body);
  if (!fields) {
    problems.push('no run configuration block found');
    return problems;
  }
  const missing = ['file', 'commit', 'layers'].filter((f) => !fields.has(f));
  for (const f of missing) problems.push(`${f}: not found in the run configuration block`);
  const file = fields.get('file');
  if (file !== undefined && file !== EXPECTED_FILE) {
    problems.push(`file: expected ${EXPECTED_FILE}, review shows ${file}`);
  }
  const commit = fields.get('commit');
  const want = String(expectedSha ?? '').toLowerCase();
  if (commit !== undefined) {
    const shown = commit.toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(shown) || !want.startsWith(shown)) {
      problems.push(`commit: expected ${want.slice(0, 7)}, review shows ${commit}`);
    }
  }
  const layers = fields.get('layers');
  if (layers !== undefined && layers !== EXPECTED_LAYERS) {
    problems.push(`layers: expected exactly "${EXPECTED_LAYERS}", review shows "${layers}"`);
  }
  // Searched over the whole picked text, not the cut block, so a rendering outside it still
  // counts. A finding that merely quotes the phrase fails too: that errs closed, on purpose.
  // The parsing error search above also covers only the picked text, on purpose: the vendor
  // puts that warning at the top of the summary (the Walkthrough), and an old reply quoting it
  // must not fail a later, healthy push (#851 gate, round 2).
  if (body.includes('Enforced overrides')) problems.push('enforced overrides: a global override is in force');
  return problems;
}

// Which of the bot's texts to check: the most recent one whose block names the head commit,
// else the most recent one holding a block (its commit problem is then reported), else the
// newest one. A later edit to a stale Walkthrough must not hide a head-commit review. `at` is
// updated_at for an issue comment and submitted_at for a review; a tie goes to the issue
// comment, where the block was observed.
export function pickText(comments, reviews, headSha = '') {
  const rows = [
    ...comments.filter((c) => c?.user?.login === BOT)
      .map((c) => ({ kind: 'issue-comment', id: c.id, at: c.updated_at ?? '', body: c.body ?? '', rank: 1 })),
    ...reviews.filter((r) => r?.user?.login === BOT)
      .map((r) => ({ kind: 'review', id: r.id, at: r.submitted_at ?? '', body: r.body ?? '', rank: 0 })),
  ];
  if (!rows.length) return null;
  rows.sort((a, b) => (a.at === b.at ? b.rank - a.rank : a.at < b.at ? 1 : -1));
  const head = String(headSha).toLowerCase();
  const atHead = (r) => {
    const commit = findBlock(r.body)?.get('commit')?.toLowerCase();
    return Boolean(head && commit && /^[0-9a-f]{7,40}$/.test(commit) && head.startsWith(commit));
  };
  return rows.find(atHead) ?? rows.find((r) => r.body.includes(HEADING)) ?? rows[0];
}

class GhError extends Error {}

function gh(args) {
  try {
    // Every issue comment and review body of a long pull request can pass Node's 1 MiB default.
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const detail = String(err.stderr || err.message || err).trim().split('\n')[0];
    throw new GhError(detail);
  }
}

// `--paginate --slurp` gives one array per page; flatten them.
const ghList = (path) => JSON.parse(gh(['api', '--paginate', '--slurp', path])).flat();

function main(argv) {
  const pr = argv[0];
  if (argv.length !== 1 || !/^[0-9]+$/.test(pr ?? '')) {
    console.error('usage: check-coderabbit-applied.mjs <pull request number> (run inside the checkout)');
    console.error('pull request number must be digits');
    return 2;
  }
  let head;
  let picked;
  try {
    head = JSON.parse(gh(['pr', 'view', pr, '--json', 'headRefOid'])).headRefOid;
    const comments = ghList(`repos/{owner}/{repo}/issues/${pr}/comments`);
    const reviews = ghList(`repos/{owner}/{repo}/pulls/${pr}/reviews`);
    picked = pickText(comments, reviews, head);
  } catch (err) {
    if (!(err instanceof GhError)) throw err;
    console.error(`gh failed: ${err.message}`);
    return 3;
  }
  console.log(`pr ${pr} head ${head} source ${picked ? `${picked.kind} ${picked.id}` : 'none'}`);
  if (!picked) {
    console.error(`no comment from ${BOT} yet`);
    return 1;
  }
  const problems = checkApplied(picked.body, head);
  for (const p of problems) console.error(p);
  if (problems.length) return 1;
  console.log('ok');
  return 0;
}

// pathToFileURL, not string concatenation: a checkout path with a space would never match.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
