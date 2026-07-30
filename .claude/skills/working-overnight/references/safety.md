# working-overnight: safety model

Binding rules for every cycle. When in doubt, park the item; never guess on
anything irreversible.

## Tiers by output reversibility

- **Tier 1 (free):** investigations, full or security reviews, research, drafting
  and gating tickets. Produces reviewable artifacts, changes no code. Run freely.
- **Tier 2 (park for review):** implementing a cleanly-gated ticket, opening a PR.
  Reversible via review; runs, but the PR waits for the human. Never merged.
- **Tier 3 (never unattended):** merge to a default or protected branch,
  force-push, delete branches/tags/data, deploy or release, read or write secrets,
  disable a CI gate, or anything touching production. Park the item as needs-human.

## Hard never-list (Tier 3)

Do NOT, unattended, under any manifest: merge to main, `git push --force`, delete
remote branches or tags, run a deploy or release, read or write secrets, disable a
CI gate, or act outside the project's repo and its worktrees.

Destructive git and secrets/bulk-delete commands are additionally enforced
mechanically by the overnight-guard hook while a run is armed: it denies them at
the PreToolUse boundary, so a drifting cycle is blocked even if this prose is not followed.
Merge and protected-branch push are left to the platform's branch protection.

## Gating filters, never self-approves

A ticket this run authored is implemented only if it cleanly passes ticket-gate. A
ticket that needs synthesis, a waiver, or a judgment call to pass is parked, not
forced through. The gate keeps its meaning only if it can say no.

## Isolation

One git worktree per implementation item so parallel work cannot collide and main
is never checked out for edits. Remove the worktree once the PR is open.

## Logging

Every assumption (a Tier-2 low-stakes proceed) and every deferral (a you-only
decision or a Tier-3 park) is written down and appears in the morning report.
Silent choices are not allowed.
