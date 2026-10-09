# Plan: Review follow-up hardening

## Goal

Clear the review debt that earlier phases turned into tickets, so that every guard test in the tree can fail, no error is swallowed, and nothing writes to stdout under stdio.

## Done looks like

- Every ticket listed under Expected work is closed with its change on `develop`, or was moved out with a recorded reason.
- Each "test that cannot fail" fixed in this phase has been mutation-checked: the fix commit or its ticket comment names the mutation that now turns it red.
- `updateTransactionBatch` reports an infrastructure error as an error on both the pooled and legacy paths (#521), and the rule reference guard covers every rule write path, not just create (#522).
- `npm run dev -- --stdio` writes nothing but JSON-RPC to stdout (#502), and transport-level refusals reach the log (#504).
- The changes are released with dual-transport evidence.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- A "hardening" fix injected a defect. Thirteen small changes land in a few files, four of them in `src/lib/actual-adapter.ts`. The adapter tickets (#521, #522, #524, #523) were done in parallel and conflicted, or one reintroduced the nested-session deadlock. Do them serially, in the order below, and run `test:adapter` after each.
- #521's fix classified the pool-drop rejection correctly on the legacy path but not the pooled one, because #523 already noted that the force-shutdown is read only on the legacy branch. The test passed on the path nobody runs in production. Verify the mechanism on both paths before writing the test.
- #522 made `createRule` stop retrying but left `upsertRule` retrying, so duplicate rules could still be created. Or the guard was added in a tool instead of the adapter, inside one `queueWriteOperation`.
- The guard-hardening tickets (#503, #505, #499, #525) each wrote their own comment stripper. Three slightly different ones now disagree about what counts as code, and a guard fails open on one of them. Share one helper.
- A source guard was "hardened" into something brittle that fails on every refactor, so the next contributor deletes it. Prefer a behavioural test where one is cheap.
- The phase grew. Review rounds on these fixes filed new low tickets, and those went back into this phase rather than to Backlog, so the phase never closed. New lows found here go to Backlog unless they are a defect in this phase's own fix.
- #504's logging was added on stdio by way of stdout, or it logged request bodies and leaked data that the redaction layer would have scrubbed.

## Expected work

Not binding. In order. Revised by the phase review of 2026-10-09: #532 and #533 were created, #521, #522, #523, #524, #504, #503 rewritten, #525 and #505 split.

Adapter tickets, serially, `test:adapter` after each:

1. #502: route the `--debug` notice through stderr (stdio stdout write).
2. #519: guard the cleanup of `batch_uncategorized_rules_upsert` so a thrown call cannot strand its disposable objects until the next run's pre-run sweep.
3. #521, with #523 item 1 folded in: abort `updateTransactionBatch` on a pool-drop error. The drop happens on the legacy path only; on the pooled path only when the following sync also fails.
4. #522, with #524 items 1, 4 and 6 folded in: guard NEW rule references on update and upsert, a category check on `updatePayee`, and `createRule` raw create retries set to 0.
5. #524: the remaining #485 follow-ups (sort test, rate-limit test label, `category_group` gap, manual-prompt totals).
6. #523: the remaining #516 follow-ups.

Test and guard tickets, independent of the adapter chain:

7. #532: one shared comment-stripping helper, before any guard ticket that strips comments.
8. #499, #487, #526, #504, #505 (L3 to L5): independent of each other.
9. #503 and #533 (#525 items 3, 6, 8 and #505 L1): consume #532's helper.
10. #525 (items 1, 2, 4, 5, 7): any time.

## Out of scope

- #518 (`transferBudgetAmount` docstring), #513 (OIDC scopes comment wording) and #488 (refresh-token lifetime guidance): Backlog. Docs-only polish with no defect behind it; pull #518 back if #523 item 2 touches the same comment.
- Transports whose pool entry was dropped and never re-created are never evicted: Backlog (#530). It predates this phase and is a bounded resource leak, not a review follow-up.
- New review findings at low severity raised while doing this phase's work: Backlog.
