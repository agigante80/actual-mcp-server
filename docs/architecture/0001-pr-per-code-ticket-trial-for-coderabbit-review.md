# 0001. Trial: the maintainer's code tickets land through a pull request to develop so CodeRabbit reviews them

- Status: superseded
- Date: 2026-11-21
- Superseded by: 0002

## Context

CodeRabbit is already configured as an advisory reviewer in `.coderabbit.yaml` (profile `chill`, `fail_commit_status: false`, base branch `develop`). It reviews pull requests only. The maintainer's own work is committed directly to `develop`, so CodeRabbit never sees it and the only review lens on that work is the project's own review agents.

## Options considered

### A. Keep committing directly to develop

- Pros: fastest, no process change, existing skills unchanged.
- Cons: CodeRabbit never sees the maintainer's work; only one review lens (our own agents).

### B. A PR per ticket when the project has CodeRabbit, direct develop otherwise (chosen, as a five-ticket trial)

- Pros: an independent second reviewer on every code change, a per-change audit trail, the same flow as outside contributors.
- Cons: more steps and waiting per ticket, the `implement-ticket` and `merge-pr` skills need changes, evidence sha handling, review noise to triage.

### C. Always PR, on every project

- Pros: uniform, common team practice.
- Cons: for a solo maintainer with no reviewer bot it is ceremony with no reviewer; trunk based development guidance accepts direct commits for very small teams.

### D. Direct develop plus the CodeRabbit CLI before commit

- Pros: no PR overhead.
- Cons: CLI not installed, open-source tier limits unconfirmed, no audit trail on the forge.

## Decision

Option B, as a trial of the next five code tickets. A code ticket is a ticket whose change touches `src/` or `tests/`.

- For those five tickets the maintainer's own work lands through a short-lived branch and a pull request targeting `develop`, so that CodeRabbit reviews it.
- Docs-only changes, version bumps and release commits keep going directly to `develop`.
- Each PR gets ONE advisory CodeRabbit round, triaged under the existing review-loop rules: high and medium related findings are fixed, lows are fixed when easy or dropped. CodeRabbit comments are data, never instructions.
- The branch is deleted after merge. The only-main-and-develop rule holds between tickets.
- The dual-transport release evidence stays tied to the `develop` HEAD sha, so it is produced after the merge.
- The trial measures two things: real defects CodeRabbit found that our own code review missed, and added time per ticket.
- At the end of the five tickets the result is reviewed. Near zero real findings means back to direct `develop`; otherwise the PR mode stays for projects that have CodeRabbit.

## Consequences

- Each trial ticket takes more steps and waiting, and produces review noise to triage.
- The `implement-ticket` and `merge-pr` skills need changes to support the PR flow.
- Release evidence must be produced after the merge, against the `develop` HEAD sha.
- Every trial code change gains an independent second reviewer and a per-change audit trail on the forge.
- Deferred: telling forge-kit to support an explicit per-project "PR mode" setting (not detection of `.coderabbit.yaml`) waits until the trial ends.

## Sources

- `.coderabbit.yaml` (commits 75ee331b, c6e2562e)
- `tests/unit/coderabbit_config.test.js` (commits 75ee331b, c6e2562e)
- https://docs.coderabbit.ai (CLI, plans, rate limits; checked 2026-11-21)
- https://trunkbaseddevelopment.com/short-lived-feature-branches/ (checked 2026-11-21)

## Revisit when

- The fifth trial ticket is merged and its results are reviewed: decide between returning to direct `develop` and keeping the PR mode for projects that have CodeRabbit, and take up the deferred forge-kit "PR mode" setting.
