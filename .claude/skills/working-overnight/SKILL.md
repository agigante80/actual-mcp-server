---
name: working-overnight
description: Run governed, unattended overnight work. Pulls from a defined work source (gated tickets, tickets to gate, or investigations like full/security reviews that create tickets), implements safe work as branch-plus-PR without ever merging, defers you-only decisions instead of guessing, and writes a morning report. Use when the user says to work overnight, run unattended, keep going while they are away, or asks to set up autonomous overnight work. Driven by /loop; not a single unbounded session.
---

<!-- working-overnight-version: 3 -->

# Working overnight

Governed unattended work while the user is away. The engine is `/loop`: the user
launches `/loop working-overnight` and each cycle does one unit of work and returns
with fresh context. This skill holds the policy: what to pull, how to stay safe,
when to defer, and when to wind down. The `overnight-continue` hook keeps a single
cycle from halting on a question; it is not the engine.

Read `references/safety.md` (the tier model and the never-list) and
`references/pipeline.md` (the per-task governance pipeline) before the first cycle.
They are binding.

## Two modes, told apart by the manifest

- **Pre-flight** (interactive, once, when the user sets up the night): arm the run.
- **Cycle** (each `/loop` iteration, unattended): do one unit of work.

If `.claude/overnight/active.md` is absent, this is pre-flight. If it is present,
this is a cycle.

## Pre-flight (arming)

Do this with the user present. Never start autonomous work until they confirm.

1. Agree the work source and scope: which tickets, which investigations, and any
   no-go areas (paths, systems, ticket labels to avoid).
2. Agree the budget (token or cost ceiling) and the investigation-depth cap (how
   many new tickets an investigation may create before implementation must catch up).
3. Confirm the safety config in `references/safety.md`: the allowed tools and the
   Tier-3 never-list. Do not proceed if the requested work would need anything on
   the never-list.
4. Ensure `.claude/overnight/` is gitignored.
5. Write the manifest to `.claude/overnight/active.md` (scope, budget, caps, no-go
   list, start time) and seed `.claude/overnight/queue.md` with the initial items.
   Creating the manifest arms the hook.
6. Tell the user to run `/loop working-overnight` and leave. Stop here.

## Cycle (one unit of work)

1. Re-read `.claude/overnight/active.md`, `.claude/overnight/queue.md`, and the
   project rules (CLAUDE.md, whose coding standards are inline). Fresh every cycle:
   this is why rule-drift does not accumulate.
2. Pick the next item by priority: a cleanly-gated ready ticket, else an ungated
   ticket to gate, else a bounded investigation. If no safe item remains, go to
   Wind-down.
3. Classify the item by tier (`references/safety.md`). A Tier-3 action is never
   performed: park it as needs-human and pick another item.
4. Resolve any question. Try web search, the code, and the project rules first.
   Only a genuine you-only decision blocks: if it is low-stakes and reversible,
   record the assumption for the report and continue; otherwise append it to
   `.claude/overnight/decisions.md` (item, options, your recommendation) and pick
   another item.
5. Do the work through `references/pipeline.md`.
6. Implementation lands in a per-item git worktree as a branch and a PR, never
   merged. Investigations write findings and create/gate tickets.
7. Update `.claude/overnight/queue.md` (done, parked, or newly created items).
8. Backstop: if context or the budget is near its limit, go to Wind-down now rather
   than starting another item.

Delegate the heavy work (implementation, review) to subagents so their tool output
does not fill this cycle's context.

## Wind-down

Reached at queue-empty (the goal) or the backstop.

1. Write `.claude/overnight/report.md`: PRs opened (links), decisions deferred (with
   options), investigations done, assumptions to verify, suggested next steps. Use
   the handoff shape from the `closing-sessions` skill.
2. Remove `.claude/overnight/active.md` to disarm the hook.
3. Stop the loop: call `ScheduleWakeup` with `stop: true` so no further cycle fires.
4. Print a one-line summary pointing at the report.
