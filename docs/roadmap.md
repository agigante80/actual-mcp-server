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
state: done
plan: docs/plans/write-path-verification.md

`@actual-app/api` 26.9.0 and 26.10.0 return from transaction update and delete without waiting for the batch update to finish, so a read straight after a write can miss it. #489 closed this race only for split conversion. This phase starts by measuring whether the other write shapes actually miss on a live budget. It fixes only the shapes that reproduce, and it tightens the #489 poll and its tests. It sits after the hardening pass because it needs live measurement and a dual-transport run, while the hardening work needs neither.

Outcome (2026-10-11): done. The #493 measurement found the upstream race real at the raw API layer (30/30 reads missed for every shape) but not through the server (0/20), because every adapter drain ends in `api.sync()`, which takes longer than the slowest write takes to land. So no new read-back code shipped, and #493 closed as not reproducible with the numbers. #494 (poll bounded by `ACTUAL_OP_TIMEOUT_MS`), #495 (partial split visibility test), #538 (batch deadline) and #544 (rate-limit outcome wording) shipped in v0.22.25 to v0.22.28 with dual-transport evidence. No work was skipped and no follow-up tickets were needed.

## Phase: API coverage and schedules
state: done
plan: docs/plans/api-coverage-and-schedules.md

Close the gaps between what `@actual-app/api` offers and what the tools expose. Monthly schedule patterns (last day, nth weekday) cannot be created today. The api-surface-drift lane reports each new uncovered method (`mergeTransactions` and `setPreference` arrived with 26.10.0), and each one needs a decision: build a tool, or accept the gap in `docs/audit/api-coverage-baseline.json` with a reason. It is last because nothing here is reported as blocking a user.

Outcome (2026-10-11): done. All four planned tickets shipped in v0.22.31 with dual-transport evidence: #515 (setPreference accepted as a gap), #527 (isbetween takes a { num1, num2 } range, measured live before shipping), #478 (monthly patterns) and #514 (actual_transactions_merge, tool count 83 to 84). The drift lane reports no unaccepted method at @actual-app/api 26.10.0. One change of shape: the two transfer merge cases run in the live suite instead of docker E2E, because that stack runs NODE_ENV=test, where upstream deadlocks a transfer merge. #547 (a payee-less schedule never links) surfaced during #527 and went to Backlog.

## Phase: Session and transport hygiene
state: done
plan: docs/plans/session-and-transport-hygiene.md

Split from "Backlog": Four gate-ready lows from the v0.22.18 and v0.22.19 reviews had no phase that would ever schedule them: they are about HTTP session bookkeeping, transport error logging and OIDC refresh-token guidance, not decisions deferred on purpose. Grouping them gives them a slot after API coverage and schedules.

Outcome (2026-10-14): done. The four planned tickets (#529, #530, #536, #488) shipped in v0.22.32 to v0.22.37 with dual-transport evidence, one ticket per commit and patch bump. Two tickets appeared during the work and shipped in the same train: #551 (an invalid AUTH_BUDGET_ACL degraded to an open ACL; now refuses startup) and #550 (the init-failure cause reply was served to a non-owner principal). The optional #529 item (moving the GET ownership check ahead of the transport presence check) was deliberately not done; the reason is written at the GET route in httpServer.ts. No work was skipped and no follow-up tickets were needed.

## Phase: Reporter follow-ups
state: done
plan: docs/plans/reporter-follow-ups.md

Split from Backlog: the fixes split out of three outside reports, #555 (tool content in the logs), #552 (HTTP DELETE returns 404) and #553 (inaccurate server instructions, guessed names in queries). Three batches, each released before the next: logs first because budget data reaches production logs today, then session teardown because an outside user is affected, then instructions.

Outcome: done (2026-10-15). All seven tickets shipped: batch 1 (#556, #558, #559) in v0.22.40, batch 2 (#564, #563) in v0.22.42, batch 3 (#560, #561) in v0.22.44, each with full dual-transport evidence. Work that appeared during review went to Backlog as P2 bugs: #565 (dev launcher cannot start the server), #566 (NOT LIKE on a joined field rejected), #567 (an escaped quote never matches with = or LIKE).

## Phase: Query parser and launcher fixes
state: done
plan: docs/plans/query-parser-and-launcher-fixes.md

Split from Backlog: three P2 bugs found while implementing the Reporter follow-ups phase. Two are in `actual_query_run` (#567 an escaped apostrophe never matches, with a fix offered by an outside contributor in PR #568; #566 `NOT LIKE` on a joined field is rejected) and one is the dev launcher (#565). Small and independent, released together after one full dual-transport run.

Outcome: done (2026-10-16). All three tickets shipped in v0.22.46 after one full dual-transport run. Two changed shape on the way: #567 also gained a guard refusing quote characters on id columns, a review finding that also affected earlier releases (credited in the release notes along with PR #568, closed as superseded), and the 401 in #565 turned out to be the local-env container answering the advertised LAN address, so the self-test now targets the bound address and the need for a live Actual server past `initialize` is documented. No new tickets: `NOT IN` and `NOT BETWEEN` on a joined field still reach the parser's existing, explicit "not yet supported" error, unchanged from before.

## Phase: Multi-client isolation
state: done
plan: docs/plans/multi-client-isolation.md

Split from Backlog: PR #569 by @jospaquim (per-principal static tokens so several LobeChat assistants can share one server) carried two independent fixes along with the feature. They were filed as #570 (restricted callers can list budgets outside their ACL and import past it), #571 (a session can download its budget from the wrong Actual server in a multi-server registry) and #572 (the `MCP_STATIC_TOKENS` feature, which depends on both). The ACL fix comes first and ships on its own.

Outcome (2026-10-21): done. All three planned tickets shipped, each released with dual-transport evidence: #570 in v0.22.47 (alone, as planned), #571 in v0.22.49 and #572 in v0.22.50, with @jospaquim as co-author and credited. One ticket appeared that the plan did not expect: #574 (a stalled login on one server failed the next operation of every session), found while building #571 and shipped in v0.23.0. #572 went out as a patch although an opt-in feature is a minor, so v0.23.0 carries the minor bump. Work the phase surfaced but did not take went to Backlog: #575 (two processes on one data dir), #576 (#270 regression residue), #577 (per-principal session cap) and #578 (hono advisory lockfile refresh).

## Phase: Shared data dir and gate hygiene
state: done
plan: docs/plans/shared-data-dir-and-gate-hygiene.md

Phase 1 exists because our own release gate is the second writer: the full run's `docker exec ... --stdio` step opens the same data dir as the running server (#575), and the #270 regression step leaves residue behind (#576). Until both are fixed the dual-transport evidence can be red, or green, for reasons unrelated to the change under test. The two direct dependency bumps (#579, #580) ride along because they need the same full run to ship and carry no design risk. It comes first because every later phase releases through this gate.

Outcome (2026-10-21): done. All four planned tickets shipped in v0.23.3 after two consecutive green full dual-transport runs with zero residue: #576, #575 (harness stdio servers now run as `app` on their own data dir, pinned by `tests/unit/harness_stdio_data_dir.test.js`), #579 and #580. One change of shape: a fresh harness data dir has to download the budget before the #270 stall step, so that step now warms up first. Two defects in the zero-residue assertion itself surfaced during the phase and went to Backlog rather than extending it: #583 (a failed listing counts as empty) and #584 (category groups are never checked).

## Phase: Residue check integrity
state: done
plan: docs/plans/residue-check-integrity.md

The zero-residue assertion in the release gate can certify a budget it never read (#583) and never sees category groups (#584), both found while closing Shared data dir and gate hygiene. It comes first, ahead of Session admission hardening and Actual API 26.11 adoption, because every later phase releases through this gate.

Outcome (2026-10-21): done. Shipped in v0.23.4 after two consecutive green full dual-transport runs with zero residue. #584 made the groups, rules and schedules listings readable in their live shapes; #583 made an unreadable listing exit 1 ("could not check") instead of counting as empty, by shape and per tool, never by message text. One ticket appeared that the plan did not expect: #585, the rules module never deleted its #342 stage rule, so 192 rules had piled up unseen until #584 made rules visible. It shipped in the same release, and the first full run cleared the 197-object backlog once with `MCP_TEST_SWEEP_MAX=250`; the second run, at the default cap, found every pre-run sweep already clean. Nothing was skipped and no ticket moved.

## Phase: Session admission hardening
state: done
plan: docs/plans/session-admission-hardening.md

Concurrent initializes can exceed MAX_CONCURRENT_SESSIONS because admission is checked before a slot is reserved (#581), and one principal can fill the shared pool (#577, after #581). Since #572 several clients can share one server with their own tokens, which makes both reachable. It follows Residue check integrity so its release goes through a gate whose zero-residue claim is true.

Outcome (2026-10-21): done. Shipped in v0.24.0 after two consecutive green full dual-transport runs with zero residue. #581 reproduced first (6 parallel initializes at a cap of 2 all admitted on the old code) and now reserves a slot synchronously at initialize, released on every exit path. #577 added the opt-in `MAX_SESSIONS_PER_PRINCIPAL` on top of that reservation: it counts OIDC subjects and named static tokens, exempts the legacy shared token and unauthenticated requests by auth method, and its 503 names only the caller's own cap and count. No ticket appeared that the plan did not expect, nothing was skipped, and no ticket moved. The #581 gate hit the bad-fix trip wire after 3 rounds; the #577 review found one medium (a wrong variable name in the docs) and two lows, all fixed before the commit.

## Phase: Docs and README restructure
state: done
plan: docs/plans/docs-and-readme-restructure.md

The README has documented install paths that fail when pasted, hand-typed counts that drifted from the registry, and a tool catalogue and env table that duplicate docs/. The docs tree mixes how-to, reference and contributor material, and the root holds test-only files. #599 collected the findings; this phase splits it into tickets that each leave CI green, in dependency order, with a link check and a marker guard landing before any file moves. It opens ahead of Actual API 26.11 adoption because that phase cannot start until upstream publishes 26.11.0.

Outcome (2026-10-30): done. All ten planned tickets (T1 to T10 as #600 to #609) shipped one per commit and patch bump in v0.24.6 to v0.24.15, released together as v0.24.15 with dual-transport evidence. The order followed the plan: #602 (docs:check with link check and marker guard) landed before any file moved. One ticket appeared during the work and was placed in Backlog rather than extending the phase: #610 (publish to the official MCP Registry). The template lockstep guard's silent pass on a marker-less canonical doc was filed upstream as agigante80/forge-kit#576. No planned work was skipped.

## Phase: Actual API 26.11 adoption
state: planned
plan:

Adopts stable @actual-app/api 26.11.0, which carries the upstream fixes we contributed (actual#9020 for #479, actual#8998 for #548). Nothing here can start before that release is published; the bump ticket is filed when Dependabot opens it. It sits after Residue check integrity and Session admission hardening so the API bump is verified by a gate whose zero-residue claim is true. If 26.11.0 lands earlier, it waits for the open phase to close rather than interleaving.

## Phase: Backlog
state: backlog

The holding phase, and it never closes. Ideas blocked on upstream (expanded schedule dates need actualbudget/actual#9020), design work that must be requested on its own (#413, one api instance per budget), and anything not yet placed. A ticket here has a decision deferred on purpose, not forgotten.
