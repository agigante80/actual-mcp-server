// #405: a commit message must not be able to close a ticket its author is leaving open.
//
// GitHub reads a closing keyword followed by an issue reference as an instruction to close, and it
// does not care that the surrounding sentence says the opposite. The close fires when the commit
// reaches the DEFAULT BRANCH, which in this repo means during a release, days after the commit was
// written, looking in the timeline exactly like a deliberate close.
//
// It fired THREE times in one afternoon: #391 (via 6d61c750, released as v0.16.5), #414 (via
// 320ea7d, v0.16.7) and #416 (via e5b08a9, v0.16.8). The second and third happened after the hazard
// had been filed as this ticket AND written into the project's memory, by the same author, using
// the same phrase. That is the argument for a hook rather than a convention: a rule its own author
// breaks twice within two hours of writing it down is not a control.
//
// Run: node tests/unit/commit_message_closing_keyword.test.js

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'hooks', 'block-closing-keyword.py',
);

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#405-closing-keyword] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

// The dangerous phrase, ASSEMBLED AT RUNTIME rather than written as one literal.
//
// Not squeamishness. This file is edited through tool calls that the hook itself inspects, so a
// verbatim fixture makes every future edit of this file trip its own guard, which is how a guard
// gets switched off. Assembling keeps the fixtures faithful where it matters (at runtime, where the
// hook sees them) while leaving the source safe to edit. The parts stay readable.
const NEG = 'Filed rather than ';
const KW = 'fixed: ';
const phrase = (n) => `${NEG}${KW}#${n}`;
const GIT_COMMIT = ['git', 'commit'].join(' ');

function runHook(command, toolName = 'Bash') {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  const out = execFileSync('python3', [HOOK], { input: payload, encoding: 'utf8' });
  if (!out.trim()) return { blocked: false };
  const parsed = JSON.parse(out);
  return { blocked: parsed.decision === 'block', reason: parsed.reason };
}
const commit = (msg) => `${GIT_COMMIT} -m ${JSON.stringify(msg)}`;

// --- the three real incidents ---------------------------------------------
describe('the three messages that actually closed a ticket are blocked');
{
  const real = [
    `fix(security): close the remaining budget-isolation holes (#390)\n\n${phrase(391)}, the cost this fix introduces.`,
    `fix(adapter): track the import load (#394)\n\n${phrase(414)}.`,
    `perf(adapter): serialise the api mutex by budget (#391)\n\n${phrase(416)}.`,
  ];
  for (const msg of real) {
    check(runHook(commit(msg)).blocked, `blocked: ${msg.split('\n').pop().slice(0, 44)}`);
  }
}

// --- the deliberate uses, which must NEVER be blocked ---------------------
// About twenty commits here use `Closes #N` correctly. Banning those would be wrong and would train
// people to bypass the hook, which is worse than not having one.
describe('deliberate closing keywords are allowed');
{
  for (const msg of [
    'Closes #347',
    'Closes #315. Supersedes #302.',
    'are unaffected. Closes #298. CI-only change.',
    'fix(adapter): downloadBudget can resolve with no budget open (#396)',
  ]) {
    check(!runHook(commit(msg)).blocked, `allowed: ${msg.slice(0, 44)}`);
  }
}

// --- the remedies the hook itself recommends ------------------------------
// An earlier draft blocked these, which would have made the hook block its own suggested fix.
// GitHub acts only when the reference IMMEDIATELY follows the keyword, so a comma breaks it.
describe('the recommended remedies are allowed, or the hook argues against itself');
{
  for (const msg of [
    `${NEG}fixed, see #391`,
    'Tracked separately as #12',
    'Filed as #391 rather than fixed here',
    '#7 was not fixed in this change',
  ]) {
    check(!runHook(commit(msg)).blocked, `allowed: ${msg.slice(0, 44)}`);
  }
}

// --- an INVOCATION, not prose that mentions one ---------------------------
// The first version matched the substring anywhere in the command, so it blocked a call that was
// writing DOCUMENTATION about this hook. A guard that fires on text about itself is noise.
describe('it fires on an invocation, not on prose mentioning one');
{
  const doc = `python3 -c "write('the hook blocks a ${GIT_COMMIT} whose message says ${phrase(391)}')"`;
  check(!runHook(doc).blocked, 'documentation quoting the phrase is allowed');

  const described = `echo "run ${GIT_COMMIT} -m ... to see the block: ${phrase(391)}"`;
  check(!runHook(described).blocked, 'an echo describing the command is allowed');

  check(runHook(`npm run build && ${commit(phrase(391))}`).blocked, 'a real invocation after && is blocked');
  check(runHook(`cd /tmp; ${commit(phrase(414))}`).blocked, 'and after a semicolon');
}

// --- only the message is scanned when it can be isolated ------------------
describe('a -m message is scanned, and unrelated command text is not');
{
  const noisy = `${GIT_COMMIT} -m "chore: tidy" --author=${JSON.stringify(phrase(391))}`;
  check(!runHook(noisy).blocked, 'text outside the -m message does not trigger it');
  check(runHook(`${commit(phrase(391))} --no-verify`).blocked, 'and the -m message still does');
}

// --- scope and failure mode -----------------------------------------------
describe('it only inspects commits, and fails open on anything it cannot parse');
{
  check(!runHook(`echo ${JSON.stringify(phrase(391))}`).blocked, 'a non-commit Bash call passes through');
  check(!runHook(commit(phrase(391)), 'Write').blocked, 'a non-Bash tool passes through');
  const out = execFileSync('python3', [HOOK], { input: 'not json at all', encoding: 'utf8' });
  check(out.trim() === '', 'unparseable input fails OPEN, because a wedged repo is worse than a missed note');
}

// --- the block has to teach, not just refuse ------------------------------
describe('the block explains the mechanism and the fix');
{
  const r = runHook(commit(phrase(391)));
  check(/default branch/i.test(r.reason || ''), 'it explains that the close fires on the default branch');
  check(/adjacency/i.test(r.reason || ''), 'and names the adjacency as the thing to break');
  check(/not blocked/i.test((r.reason || '').replace(/\n/g, ' ')), 'and says a deliberate Closes #N is fine');
}

// --- the other half of #405: the release-time verification ----------------
// The hook stops the message being written. This is the proof after the fact that no ticket was
// closed by accident. It exists because the first two checks used a TIMESTAMP WINDOW around the
// push and missed both #414 and #416: clock skew, queued workflows and a multi-minute release all
// make a window a guess. Enumerating the references in the released COMMIT RANGE is deterministic.
describe('the release-time verifier parses what a release intended to close');
{
  const mod = await import('../../scripts/verify-release-ticket-states.mjs');

  // The multi-ticket subject form, which broke the release skill's own single-ticket regex once and
  // silently produced an EMPTY manifest that would have closed nothing.
  const multi = [...mod.parseIntended(['fix(adapter): track the import load (#394, #392, #402, #404)'])];
  check(multi.join(',') === '394,392,402,404', `a multi-ticket subject yields all four (got ${multi.join(',')})`);

  const single = [...mod.parseIntended(['fix(adapter): downloadBudget can resolve with no budget open (#396)'])];
  check(single.join(',') === '396', 'a single-ticket subject yields one');

  check(mod.parseIntended(['chore(release): bump version to 0.16.8']).size === 0, 'a bump commit intends to close nothing');

  // A body reference is NOT an intent to close: bodies carry CVE numbers, cross-links and the very
  // deferral notes that caused all three incidents.
  check(mod.parseIntended(['fix: something', 'see #123 for context']).size === 0, 'a body-style reference is not an intended target');

  // ...but it IS in the mentioned set, which is what could have been closed by accident.
  const mentioned = mod.parseMentioned(`${phrase(391)}, and see #414.`);
  check(mentioned.has(391) && mentioned.has(414), 'every mentioned ticket is collected for checking');
}

// --- the shape this project's commits ACTUALLY take ------------------------
// Review round 1 found the sharpest defect in this hook: the -m narrowing matched with a
// backslash-escape rule, but commits here are written as a heredoc whose body contains RAW double
// quotes. The first one terminated the match and everything after it, including the trailing
// deferral line, went unscanned. Measured: 19 of the last 30 commit bodies contain a quote, and the
// deferral line is always last. So the hook would NOT have caught the real #416 commit, the very
// incident it was written for. The fixtures below are that shape.
describe('the heredoc commit form, with raw quotes in the body, is still scanned');
{
  const q = String.fromCharCode(34);
  const body = `fix(pool): close the last unlocked shutdown (#411)\n\n` +
    `a second call surfaces as ${q}not initialized${q}, per #164.\n\n${phrase(416)}`;

  const heredocF = `${GIT_COMMIT} -F - <<'EOF'\n${body}\nEOF`;
  check(runHook(heredocF).blocked, 'a -F heredoc with inner quotes is blocked');

  const heredocM = `${GIT_COMMIT} -m ${q}$(cat <<'EOF'\n${body}\nEOF\n)${q}`;
  check(runHook(heredocM).blocked, 'the -m $(cat <<EOF) form with inner quotes is blocked');
}

// --- two invocation shapes GitHub acts on that the first version missed ----
describe('other real invocation shapes are recognised');
{
  check(runHook(`git -C /some/repo commit -m ${JSON.stringify(phrase(391))}`).blocked,
    'git -C <path> commit is recognised');
  const contraction = `${GIT_COMMIT} -m ${JSON.stringify("we do" + "n't fix #391 here")}`;
  check(runHook(contraction).blocked, "a contraction (does not fix #N) is recognised");
}

log(`\n[#405-closing-keyword] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
