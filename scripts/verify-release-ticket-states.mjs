#!/usr/bin/env node
/**
 * #405: verify that a release closed exactly the tickets it meant to, and nothing else.
 *
 * WHY THIS EXISTS. Three times in one afternoon a commit body reading "Filed rather than fixed:
 * #N" closed that ticket as COMPLETED when the release fast-forwarded main, because GitHub parses
 * `fixed: #N` as a closing keyword. The hook at .claude/hooks/block-closing-keyword.py stops the
 * message being written. This is the other half: proof after the fact that no ticket was closed by
 * accident.
 *
 * WHY NOT A TIMESTAMP WINDOW. That is what was used the first two times, and it missed both #414
 * and #416: the checker guessed a window around the push and the closes fell outside it. Clock
 * skew, queued workflows and a release that takes minutes all make the window a guess. Enumerating
 * the issue references in the released COMMIT RANGE is deterministic and needs no guessing.
 *
 * WHAT IT REPORTS. For every `#N` mentioned by any commit in the range, whether it is open or
 * closed, and which of those the release INTENDED to close (a `(#N)` suffix in a commit SUBJECT,
 * which is what implement-ticket writes and what the release skill closes deliberately). A ticket
 * that is closed but was never an intended target is the failure this catches.
 *
 * Usage:  node scripts/verify-release-ticket-states.mjs [<range>]
 *         default range: origin/main..origin/develop
 *
 * Exit 1 when a ticket is closed that the release did not intend to close.
 */

import { execFileSync } from 'node:child_process';

/**
 * Parse the tickets a release INTENDED to close: a `(#N)` group in a commit SUBJECT, which is what
 * implement-ticket writes and what the release skill acts on. Deliberately not the body, which
 * carries CVE numbers, cross-links and deferral notes that are not tickets to close.
 *
 * Exported so it can be unit-tested without a repo, and because the multi-ticket form
 * `(#394, #392, #402)` broke the release skill's own single-ticket regex once.
 */
export function parseIntended(subjects) {
  const intended = new Set();
  for (const s of subjects) {
    for (const group of s.match(/\(#\d+(?:,\s*#\d+)*\)/g) || []) {
      for (const n of group.match(/\d+/g) || []) intended.add(Number(n));
    }
  }
  return intended;
}

/** Every `#N` mentioned anywhere in the range: the set that could have been closed by accident. */
export function parseMentioned(text) {
  const mentioned = new Set();
  for (const n of text.match(/#\d+/g) || []) mentioned.add(Number(n.slice(1)));
  return mentioned;
}

const range = process.argv[2] || 'origin/main..origin/develop';
// B1 (review): this module is IMPORTED by its unit test, so everything below must be behind this
// guard. Without it the import ran `git log origin/main..origin/develop`, one `gh issue view` per
// mentioned ticket, printed a release report from inside a unit test, and could call process.exit(1)
// mid-test. It passed locally only because this clone has the refs and the range was empty; on a
// CI checkout (depth 1, single branch) the git call fails and takes the whole unit chain down.
const isMain = process.argv[1] && process.argv[1].endsWith('verify-release-ticket-states.mjs');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8' });
  } catch (err) {
    return null;
  }
}

if (isMain) {
  // A three-dot range or a missing separator used to misparse into `base = undefined`, which then
  // threw inside the attribution try/catch and was swallowed as "not attributable": a mistyped
  // argument produced a clean pass.
  // Note the refs themselves contain dots (v0.16.7), so this checks the SEPARATOR rather than the
  // whole string: exactly one two-dot separator, and not the three-dot symmetric-difference form,
  // whose semantics are different and whose base would parse as ".B".
  const rangeParts = range.split('..');
  if (range.includes('...') || rangeParts.length !== 2 || !rangeParts[0] || !rangeParts[1]) {
    console.error(`Range must be of the form A..B with a single two-dot separator. Got: ${range}`);
    process.exit(2);
  }
  const subjects = git(['log', range, '--pretty=format:%s']).split('\n').filter(Boolean);
  const bodies = git(['log', range, '--pretty=format:%B']);

  // INTENDED targets: a `(#N)` suffix group in a SUBJECT. Deliberately not the body, which carries
  // CVE numbers, cross-links and deferral notes that are not tickets to close.
  const intended = parseIntended(subjects);
  const mentioned = parseMentioned(bodies);

  const unexpected = [];
  const unverified = [];
  const rows = [];
  for (const n of [...mentioned].sort((a, b) => a - b)) {
    const out = gh(['issue', 'view', String(n), '--json', 'state,title']);
    if (!out) {
      // Commit bodies here reference PULL REQUESTS too, and `gh issue view` fails on those, so
      // without this the fail-closed path would fire on every release and stop meaning anything.
      // A number that resolves as a PR is verified-and-irrelevant, not unverifiable.
      if (gh(['pr', 'view', String(n), '--json', 'number'])) continue;
      unverified.push(n);
      continue;
    }
    let info;
    try { info = JSON.parse(out); } catch { continue; }
    const closed = info.state === 'CLOSED';
    const wasIntended = intended.has(n);

    // A ticket closed by an EARLIER release, merely cross-referenced here, is not this release's
    // doing. The first version flagged five of those, which would have trained the reader to ignore
    // the output: a checker that cries wolf is worse than none. So ask WHAT closed it, and only flag
    // a close attributable to a commit in THIS range.
    let closedByThisRange = false;
    if (closed && !wasIntended) {
      // PAGINATED. The timeline API returns 30 events per page, and the tickets in these
      // incidents carry long threads, so an unpaginated `last` inspects only page one: the close
      // event is not there, the sha comes back empty, and the accidental close is silently NOT
      // flagged. That is precisely the false negative this script exists to remove.
      const tl = gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${n}/timeline`, '--jq',
        '.[] | select(.event=="closed") | .commit_id // ""']);
      const sha = (tl || '').trim().split('\n').filter(Boolean).pop() || '';
      if (sha) {
        try {
          // `git merge-base --is-ancestor A B` exits 0 when A is an ancestor of B. A close-causing
          // commit belongs to this range when it is reachable from the tip and NOT from the base.
          const [base, tip] = rangeParts;
          execFileSync('git', ['merge-base', '--is-ancestor', sha, tip], { stdio: 'ignore' });
          try {
            execFileSync('git', ['merge-base', '--is-ancestor', sha, base], { stdio: 'ignore' });
          } catch {
            closedByThisRange = true;   // reachable from the tip, not from the base: in the range
          }
        } catch { /* unknown commit: not attributable to this range */ }
      }
    }

    rows.push({ n, state: info.state, intended: wasIntended, closedByThisRange, title: (info.title || '').slice(0, 58) });
    if (closedByThisRange) unexpected.push(n);
  }

  console.log(`Release ticket states for ${range}`);
  console.log(`  intended targets (subject "(#N)"): ${[...intended].sort((a, b) => a - b).join(', ') || 'none'}`);
  console.log('');
  for (const r of rows) {
    const flag = r.closedByThisRange ? '  <-- CLOSED BY THIS RANGE but NOT an intended target' : '';
    console.log(`  #${r.n}  ${r.state.padEnd(6)}  ${r.intended ? 'intended' : 'mentioned'}  ${r.title}${flag}`);
  }

  // FAIL CLOSED on anything that could not be checked. CLAUDE.md states this posture explicitly
  // for the release-gate hook: "it fails CLOSED: if it cannot verify ... it blocks". A verifier
  // that reports OK when it verified nothing is the opposite, and a reference may be a PR or an
  // issue in another repo, so the message has to let a human tell those apart rather than guess.
  if (unverified.length > 0) {
    console.error('');
    console.error(`COULD NOT VERIFY ${unverified.length} reference(s): ${unverified.map((n) => '#' + n).join(', ')}`);
    console.error('They may be pull requests, references to another repo, or gh may be unauthenticated.');
    console.error('Check them by hand rather than treating this run as a pass.');
    process.exitCode = 1;
  }

  if (unexpected.length > 0) {
    console.error('');
    console.error(`FAIL: ${unexpected.length} ticket(s) closed that this release did not intend to close: ${unexpected.map((n) => '#' + n).join(', ')}`);
    console.error('If a commit body says a ticket was NOT fixed, GitHub may have closed it anyway.');
    console.error('Reopen it and check .claude/hooks/block-closing-keyword.py is registered.');
    process.exit(1);
  }
  // Guarded: `process.exitCode = 1` does not stop execution, so without this the unverified branch
  // above printed its warning and then this line printed "OK" underneath it. The exit code was
  // right and the last line a human reads said the opposite, on a script whose own comment argues
  // that a verifier reporting OK when it verified nothing is the failure it exists to prevent.
  if (unverified.length === 0) {
    console.log('');
    console.log('OK: every closed ticket in this range was an intended target.');
  }

}
