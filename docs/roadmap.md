# Roadmap

This file lists the phases of work and the state of each one. It does not list tickets: a ticket's phase is its GitHub milestone, which has the same name as the phase. Only the `open` phase is a commitment. A `planned` phase is a bucket that collects tickets until it opens, and its description explains why it is there, not what it will contain.

Rules (checked by the forge-kit `check-phases.sh` guard):

1. Every open ticket has a milestone. Put a ticket you are unsure about in Backlog.
2. An `open` or `done` phase has a plan file with a "Fails if" section. A phase gets its plan when it opens, not before.
3. At most one phase is `open`.
4. A `done` phase holds no open tickets. When a phase stalls, re-shape it rather than extend it.

## Phase: Chat-client tool surface
state: done
plan: docs/plans/chat-client-tool-surface.md

Chat clients (Gemini, LibreChat, Claude web) are limited to a few tool calls per turn and pay for the whole `tools/list` (82 tools, about 100 KB) on every message. #477 raised the problem. `actual_get_context` (#484) and the in-place split (#489) have already shipped. This phase finishes the remaining work in the order agreed with the reporter on #477: make the existing batch tools trustworthy and close the one real batch gap (rules), then server-side toolsets with a `chat` preset, then trimming the tool schemas and adding a size guard measured against the final tool list. It comes first because it holds the only P2 tickets and an outside contributor is waiting on it.

Outcome: done (closed 2026-10-08). All five planned tickets (#517, #516, #485, #483, #486) shipped in v0.22.17 with dual-transport evidence; #477 was closed as split. `tools/list` went from 102,836 bytes (82 tools) to 101,827 bytes (83 tools) under a committed ceiling. The schema trim covered seven tools rather than the planned six. Review follow-ups went to Review follow-up hardening (#522, #525, #526) and API coverage and schedules (#527).

## Phase: Review follow-up hardening
state: done
plan: docs/plans/review-follow-up-hardening.md

Small, independent follow-ups that code reviews below the fix threshold turned into tickets: guard tests that could not fail, a stdio stdout line in dev mode, missing transport error logging, dotenv precedence in the non-server scripts, and OIDC wording. Each one is cheap and gate-ready. Grouping them clears the review debt in one pass, instead of letting it trickle into feature phases where it competes with work that has a deadline.

Outcome (2026-10-09): done. All 15 tickets shipped in v0.22.19, released with dual-transport evidence. The phase review split #525 and #505 and created #532 (one shared comment stripper) and #533; nothing was dropped. The bounded review of the phase found no high or medium defects, and its lows went to Backlog as #535 to #541 rather than back into this phase.

## Phase: Write-path verification
state: open
plan: docs/plans/write-path-verification.md

`@actual-app/api` 26.9.0 and 26.10.0 return from transaction update and delete without waiting for the batch update to finish, so a read straight after a write can miss it. #489 closed this race only for split conversion. This phase starts by measuring whether the other write shapes actually miss on a live budget. It fixes only the shapes that reproduce, and it tightens the #489 poll and its tests. It sits after the hardening pass because it needs live measurement and a dual-transport run, while the hardening work needs neither.

## Phase: API coverage and schedules
state: planned

Close the gaps between what `@actual-app/api` offers and what the tools expose. Monthly schedule patterns (last day, nth weekday) cannot be created today. The api-surface-drift lane reports each new uncovered method (`mergeTransactions` and `setPreference` arrived with 26.10.0), and each one needs a decision: build a tool, or accept the gap in `docs/audit/api-coverage-baseline.json` with a reason. It is last because nothing here is reported as blocking a user.

## Phase: Backlog
state: backlog

The holding phase, and it never closes. Ideas blocked on upstream (expanded schedule dates need actualbudget/actual#9020), design work that must be requested on its own (#413, one api instance per budget), and anything not yet placed. A ticket here has a decision deferred on purpose, not forgotten.
