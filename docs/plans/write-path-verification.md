# Plan: Write-path verification

## Goal

Every transaction write that can resolve before it is visible is either proven not to miss on a live budget, or verified by a bounded read-back that throws rather than reports success.

## Done looks like

- A recorded measurement, against a disposable budget at the installed `@actual-app/api` (26.10.0), of whether a read straight after each write shape misses it: split edit, plain field update, delete, and the batch variants that share their path. The measurement lives on #493.
- Each shape that reproduced has a bounded read-back inside its `queueWriteOperation`, using one shared helper (the #489 poll, extracted once it has more than one caller). Each shape that did not reproduce has no new code, and the ticket says so with the numbers.
- The poll deadline never exceeds what `ACTUAL_OP_TIMEOUT_MS` leaves for it, so a slow write reports "outcome is unknown" and never a generic "timed out" (#494).
- A half-landed split cannot pass as success: a unit case where the parent shows fewer children than requested goes red under the `> 0` mutation (#495).
- A full dual-transport run (`bash scripts/deploy-and-test.sh full`) is green with zero residue after the last change in the phase.

## Fails if

Premortem: it is the end of this phase and it failed badly. What happened?

- **The measurement lied.** A quiet local budget showed no missed reads, so nothing shipped, but the race appears under load or against a remote server, and a user still reads a write back as missing. Guard: measure each shape many times and against the remote-style setup the dual-transport run uses, and record the counts, not a single try.
- **The fix caused the damage it was meant to prevent.** The read-back threw "outcome is unknown" for writes that had in fact landed, a client retried, and the budget gained duplicate transactions. Guard: the throw names the id to read back and says not to retry blindly, and a unit case proves a write that lands on the last poll is reported as success.
- **The phase never ended.** The measurement pointed at budgets, rules and payees as well, and the phase grew to cover every write. Guard: anything beyond transaction writes is a new ticket in Backlog, never scope here.
- **Batches got slow enough to time out.** A per-item read-back made a 50 item batch exceed `ACTUAL_OP_TIMEOUT_MS`, and the batch kept writing after its caller was told it failed. Guard: #538's deadline check lands before any per-item poll in the batch path.

## Expected work

- #493: measure first, then add the read-back only for the shapes that reproduce. Close as not reproducible, with the measurement, if none do.
- #494: bound the poll by `ACTUAL_OP_TIMEOUT_MS`. Lands before or with #493, because #493 multiplies the callers of the same poll.
- #495: the partial-visibility unit case and the prompt-2 reorder.
- #538: give `updateTransactionBatch` the same deadline check as the other two batches. If #493 adds a per-item poll to the batch path, a batch gets slower, and the missing check is what lets it keep writing after its caller timed out. Lands before any batch poll.
- #544: a rate-limit failure on the second write of `transferBudgetAmount` is reported as "unchanged", an outcome nobody knows. Same theme as this phase: never claim a write outcome that was not verified.

#538 and #544 came in from Backlog when the phase opened, under the rule that every low ticket in a phase's area joins its plan or is closed.

Not binding: a shape the measurement shows is fine produces no ticket.

## Out of scope

- Measuring or polling the visibility race for writes outside transactions (budgets, rules, payees, categories): nothing suggests they race the same way. Backlog, if one ever does. (#544 is in scope because it is about what an error message claims, not about visibility.)
- Changing upstream `@actual-app/api` so update and delete await the batch update: an upstream contribution under its own rules, not this phase.
