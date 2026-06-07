---
name: implement-ticket
description: >-
  End-to-end implementation pipeline for a GitHub issue in actual-mcp-server:
  gate the ticket to 10/10, implement it, validate, code-review it, and either
  fix findings inline or spin them into their own tickets, then commit + bump +
  push to develop. Use this whenever the user asks to implement, build out, do,
  work, or ship a ticket or issue by number, e.g. "implement ticket 167",
  "implement #178", "do issue 142", "build out ticket 90", or "/implement-ticket
  178", even if they do not name every step. Do NOT use it for merely reading,
  triaging, gating, or reviewing a ticket without implementing it, or for code
  changes that are not tied to a specific issue number.
---

# Implement Ticket

A repeatable pipeline that takes a GitHub issue number and carries it from
"ready to build" to "merged on develop", with adversarial review and automatic
follow-up ticketing baked in. It chains tools we already have (the `ticket-gate`
agent, the project validation sequence, `/code-review`, `/local-env`) so a
single instruction does what a careful engineer would do across an afternoon.

## When this runs

Trigger on any request to implement a specific issue by number. Extract the
issue number from the prompt. If no number is present, ask for one before
starting. Everything happens on `develop`; never touch `main` (see CLAUDE.md).

## Inputs and state to track

- `TICKET`: the issue number under implementation.
- `DEPTH`: recursion depth, starts at `0` for the user-invoked ticket. Spinning
  off and auto-implementing a discovered ticket increments it. The cap is `2`.
- `SEEN`: the set of ticket numbers this run has already started, so a follow-up
  ticket can never re-enter a ticket already in progress (loop guard).

Hold these in a TodoWrite list so progress survives a long run.

## The pipeline

Run the phases in order. A phase that cannot pass after its bounded retries
stops the run with a clear report rather than limping forward.

### Phase 1: Gate to 10/10

The ticket must score 10/10 from every gate agent before any code is written, so
the spec is unambiguous and testable.

1. Run the gate: `Agent` tool, `subagent_type: ticket-gate`, prompt = the issue
   number.
2. If the result is BLOCKED, this is fully automated (no confirmation): edit the
   issue body with `gh issue edit <n> --body-file <file>` to resolve each named
   gap, then re-run the gate. Per the re-run rule only the failed agents are
   re-scored. Make a real engineering decision for design-ambiguity blockers
   (pick the better option and justify it in the body), do not just restate the
   ticket.
3. Cap at 4 gate rounds. If it still is not 10/10, stop and report what remains.

Writing the body files: the `gh` sandbox cannot read `/tmp`, so write body files
into the repo root as a dot-file (e.g. `./.ticket-<n>-body.md`) and delete them
after the `gh` call.

### Phase 1.5: Reproduce first (bug and behaviour-change tickets)

Run this phase when the ticket is labelled `bug` OR proposes a change to existing
observable behaviour. Skip it for greenfield features with nothing to reproduce,
docs, and chore/CI tickets (say so in the report).

An incoming ticket is a HYPOTHESIS, not ground truth. External and spec-derived
tickets are routinely wrong: stale (the bug was fixed since), mis-scoped (only
part of it is real), or mis-severity. Prove the reported behaviour against the
CURRENT code before writing a fix, so you never "fix" a phantom.

1. Reproduce against current code, preferring the live `/local-env` (it caught two
   mischaracterised tickets that unit-level reasoning alone would have missed).
   Write a focused failing check that demonstrates the reported behaviour and
   capture its **red** result. That check is the start of the regression test, it
   is not throwaway.
2. Branch on the outcome, and report which happened with evidence:
   - **Reproduces as described** -> proceed to Phase 2. The red check is the test
     that must go green.
   - **Does not reproduce** -> STOP. Do not implement. Recharacterise or close the
     ticket (with the evidence), the same way the `payee_rules_get` and #211
     "already fixed / not a crash" findings were handled.
   - **Reproduces differently** (different severity, scope, or symptom) -> rewrite
     the ticket body to match reality (re-title, re-label, fix the symptom), then
     re-gate (Phase 1) before implementing.
3. Tier the rigor by source: external / community / fork-harvested tickets get the
   full treatment plus the mandatory security review; internal trivial changes can
   be lighter. When unsure, do more.

A behaviour change is not done until a check that was **red is green**. Carry the
red check into Phase 2 (make it pass) and Phase 3 (it runs in the suite). If the
fix changes observable behaviour, sweep every affected test, tool description, and
doc in Phase 2, not just the line you changed.

### Phase 2: Implement

Treat the now-10/10 ticket body as the spec. Read it in full plus CLAUDE.md, and
follow the project's conventions exactly (amounts in integer cents, dates as
`YYYY-MM-DD`, `withActualApi` around every Actual call, `createTool` for new
tools, Zod from `CommonSchemas`). Prefer delegating to the project subagents
when the work is in their domain: `tool-author` for a brand-new MCP tool, `qa`
for test-heavy work, `actual-api` for `@actual-app/api` behaviour questions.

Write the tests the ticket specifies (positive and negative) and wire new unit
tests into the `test:unit-js` chain in `package.json`. Update the docs the
ticket and CLAUDE.md's "Documentation Sync" table call for.

### Phase 3: Fast validation

Run the mandatory pre-commit sequence; all must be green before review:

```
npm run build
npm run verify-tools          # confirm the expected tool count
npm run test:unit-js
npm run test:adapter
npm audit --audit-level=moderate   # no NEW vulnerabilities
```

`test:adapter` and unit tests need Actual env vars set; export the dummy values
the CI uses (`ACTUAL_SERVER_URL=http://localhost:5006`,
`ACTUAL_PASSWORD=dummy`, `ACTUAL_BUDGET_SYNC_ID=00000000-0000-0000-0000-000000000000`).
A red phase here means fix and re-run, do not proceed.

### Phase 4: Code review

Stage the changes (`git add -A` the implemented files) so the full diff,
including new files, is in scope, then run the `/code-review` skill at high
effort on the working diff. Collect the verified findings.

### Phase 5: Triage findings (the inline-vs-ticket decision)

For each verified finding, decide with the scope-and-risk rubric:

- **Fix inline** when it is within this ticket's scope AND low-risk: typos,
  small logic corrections, a missing guard or null check, a test or doc gap.
  After inline fixes, return to Phase 3 (re-validate) then Phase 4 (re-review).
  Loop until a review pass is clean. Cap at 3 review-fix loops; if findings keep
  appearing, stop and report.
- **Spin off a ticket** when it is out of scope, a separate pre-existing bug, or
  a larger design change (a new abstraction, touching files outside this
  ticket). Create it with `gh issue create` using the bug or feature template
  (include the `<!-- template-version: 3 -->` marker and an area label so it is
  gate-ready), and cross-reference the current ticket.

  Then, if `DEPTH < 2` and the new ticket number is not in `SEEN`: auto-implement
  it now by recursing into this same pipeline with `DEPTH + 1` and the new number
  added to `SEEN`. When that nested run returns, resume the current ticket.
  If `DEPTH == 2` (cap reached) or the ticket is already in `SEEN`, do NOT
  recurse: leave the new ticket open, note it in the final report, and continue.

A finding being "major" is not automatically a reason to stop the current
ticket: only the findings that are genuinely about THIS ticket's code block its
completion. An out-of-scope discovery becomes a tracked ticket and does not gate
the current work.

### Phase 6: Live validation

Once review is clean, run `/local-env full` (which runs
`bash scripts/deploy-and-test.sh full`). This rebuilds the image from the working
tree and exercises the real server. It must pass. Skip the optional
`--bank-sync` unless the ticket is about bank sync. If the live run reveals a
real regression, treat it as a Phase 5 finding (fix inline or ticket) and loop.

### Phase 7: Finalize on develop

When validation and review are both clean:

1. Commit the implementation to `develop` with a descriptive Conventional-Commit
   message that references the ticket (`(#<n>)`), ending with the standard
   `Co-Authored-By` trailer.
2. Bump the patch version: `npm run version:bump -- patch`. It edits VERSION,
   package.json, and the doc markers (never edit those markers by hand), and
   prints the git commands. Commit the bump as
   `chore(release): bump version to X.Y.Z`. (CI-only or dev-dependency-only
   changes do not bump the product version; say so in the report.)
3. `git push origin develop`.

### Phase 8: Confirm CI is green (close the loop)

Local validation is NOT CI validation. The GitHub Actions pipeline runs steps
the local suite does not (workflow linting, multi-arch docker builds, the
docker-e2e tool-count check) and runs in a different environment (different Node,
different system tools such as `shellcheck`), so green-local can still be red-CI.
This phase exists because a real run once pushed a green-local change that failed
CI on every push and it was not noticed for a whole batch.

After the push, find the CI run for the pushed commit and wait for it to finish:

```
git rev-parse HEAD                       # the pushed SHA
gh run list --branch develop --limit 3   # find the CI/CD Pipeline run for that SHA
gh run view <run-id>                      # poll until status is completed
```

- If the run concludes **success**, the ticket is done.
- If any job fails, treat it as a Phase 5 finding: read `gh run view <id> --log-failed`,
  then fix inline if in-scope and low-risk (re-validate, re-push, re-confirm CI),
  or spin off a gate-ready ticket for an out-of-scope failure. A red CI run is NOT
  a completed ticket, even when every local gate passed. Reproduce the failing CI
  step locally with the SAME tool versions CI uses before claiming a fix.

Stop here. Do not merge to `main`, do not tag, do not release. Report the commit
hashes, the new version, the CI run conclusion (with the run id), and any
follow-up tickets created (with their numbers and whether they were
auto-implemented or left open).

## Guardrails

- **A ticket is a hypothesis, not ground truth.** For bug and behaviour-change
  tickets, reproduce against current code first (Phase 1.5). If it does not
  reproduce, recharacterise or close it, do not implement a phantom. If it
  reproduces differently, rewrite and re-gate. Never fix from the report alone.
- **Red before green.** A behaviour change is not done until a check that was red
  is green, and the fix sweeps every affected test, tool description, and doc.
- **develop only.** Never push to `main`, never tag, never release. That stays a
  separate, explicit human step.
- **No em or en dashes** anywhere (CLAUDE.md hard rule): not in commits, issue
  bodies, comments, code, or docs. Restructure with a colon, comma, parentheses,
  "to" for ranges, or two sentences. A PreToolUse hook enforces this; self-check
  regardless.
- **Recursion is depth-capped at 2** and loop-guarded by `SEEN`, so a chain of
  discovered tickets cannot run away.
- **Bounded retries** on every loop: 4 gate rounds, 3 review-fix loops. Exceeding
  a cap stops the run with a report, it does not spin.
- **Honest reporting.** If a phase fails or is skipped, say so with the evidence.
  Never claim green without the command output.
- **A ticket is not done until CI is green.** Local validation passing is
  necessary but not sufficient; always confirm the GitHub Actions run for the
  pushed commit concluded `success` (Phase 8). Never report a ticket complete on
  a red or unchecked CI run.

## Failure and resumption

If the run stops at any phase (cap exceeded, unfixable failure, gate stuck),
report exactly where it stopped, what is committed vs uncommitted, what tickets
were created, and the single next action. The user can re-invoke the skill on
the same ticket to resume; earlier phases that already passed (a 10/10 gate, a
green build) can be confirmed quickly rather than redone from scratch.
