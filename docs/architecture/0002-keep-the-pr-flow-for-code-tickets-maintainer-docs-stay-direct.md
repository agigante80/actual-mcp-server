# 0002. Keep the pull request flow for the maintainer's code tickets; maintainer docs stay direct

- Status: accepted
- Date: 2026-11-22
- Supersedes: 0001

## Context

ADR 0001 started a trial: for five code tickets the maintainer's own work landed through a short-lived branch and a pull request against `develop`, so that CodeRabbit (an advisory reviewer that sees pull requests only) reviewed it. The trial was tracked in ticket #715 and has ended. Its results:

| Pull request | Ticket | CodeRabbit findings | Real issues our own review had missed | Minutes from open to merged |
|---|---|---|---|---|
| #719 | #710 | 1 | 0 | 24 |
| #722 | #711 | 2, plus a failed "Tests cover the change" check | 2 | 58 |
| #723 | #717 | 0 | 0 | 24 |
| #725 | #712 | 1 | 1 | 57 |
| #726 | #713 | 0 | 0 | 30 |

CodeRabbit found 3 real issues that our own review had missed, all on the two tickets that changed behaviour or a refusal message. No review round went past one and nothing was blocked.

Two questions were open at the trial exit: whether to keep the pull request flow at all, and whether the maintainer's docs-only changes should go through it too. Pull requests from outside contributors were already reviewed by CodeRabbit whatever they touch, docs-only ones included: `.coderabbit.yaml` has no path restriction beyond the lockfile, `generated/` and `dist/`.

## Options considered

### Trial exit: drop the pull request flow and return to direct develop

- Pros: fastest.
- Cons: loses the reviewer that found 3 real issues in 5 pull requests.

### Trial exit: keep the pull request flow for code tickets (chosen)

The docs scope was then weighed among three options.

### A. Maintainer docs through a pull request too

- Pros: one rule for everyone; CodeRabbit reads the maintainer's docs.
- Cons: about 25 minutes of waiting per docs commit; CodeRabbit has no docs-specific check, so it mostly repeats what `npm run docs:check` already catches.

### B. Maintainer docs stay direct, outside docs pull requests are reviewed (chosen)

- Pros: no extra wait; outside contributions are still covered.
- Cons: the maintainer's own docs get no second reviewer.

### C. Maintainer docs through a pull request only for contributor-facing or user-facing pages

- Pros: review where a mistake reaches readers.
- Cons: a boundary to judge on every commit.

## Decision

The pull request flow is kept permanently, with docs scope option B.

- A maintainer ticket whose change touches `src/` or `tests/` lands through a short-lived `t/<issue>-<slug>` branch and a pull request against `develop`.
- Each such pull request gets ONE advisory CodeRabbit round. It is merged by rebase and the branch is deleted.
- The maintainer's docs-only changes, version bumps, audit records and release commits keep going directly to `develop`.
- Pull requests from outside contributors are reviewed by CodeRabbit whatever they touch, docs-only ones included. That was already the case.

## Consequences

- Every maintainer code change keeps an independent second reviewer, at a cost of roughly 24 to 58 minutes from open to merged per ticket (the trial's range).
- The maintainer's own docs get no second reviewer; `npm run docs:check` remains their check.
- The flow is no longer a trial, so wording that describes it as one is out of date.
- Deferred: telling forge-kit to support an explicit per-project "PR mode" setting is still open (carried over from ADR 0001).

## Sources

- `docs/architecture/0001-pr-per-code-ticket-trial-for-coderabbit-review.md`
- `.coderabbit.yaml`
- GitHub issue #715 of this repository (the trial table)
- Pull requests #719, #722, #723, #725, #726 of this repository

## Revisit when

- The forge-kit per-project "PR mode" setting is taken up (still open, carried over from ADR 0001).
- A maintainer docs commit ships an error a reviewer would have caught: revisit the docs scope.
- CodeRabbit's wait time or noise changes materially: revisit the docs scope.
