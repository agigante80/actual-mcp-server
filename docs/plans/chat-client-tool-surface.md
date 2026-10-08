# Plan: Chat-client tool surface

## Goal

A chat client with a strict turn limit and a small context can do the day-to-day budget work from #477 in one or two calls, against a published tool list it can afford.

## Done looks like

- `MCP_TOOLSETS`, `MCP_TOOLS` and `MCP_READ_ONLY` work. With nothing set, the server publishes exactly today's list (byte-compared). A hidden tool is refused when called, not just left out of the list.
- `MCP_TOOLSETS=chat` publishes the preset agreed on #477, and every member exists in `IMPLEMENTED_TOOLS`.
- Every multi-item task in #477 has a one-call path, or a recorded reason it does not (audit done 2026-10-08, comment on #485). Every batch tool returns per-item `succeeded` / `failed` results, reports an error as an error, and writes through the adapter guards. The README "Batch Operations" section lists every bulk path, including `actual_transactions_update_batch` and `actual_transactions_import`.
- `tools/list` is smaller than the measured baseline (82 tools, 102,836 bytes on `dbc7c9a0`). A unit test in the `test:unit-js` chain fails when it grows past a committed ceiling.
- The changes are released with dual-transport evidence. (#477, the umbrella, was closed as split on 2026-10-08, with a comment mapping it to its successors.)

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- `MCP_READ_ONLY` shipped as a false safety promise. It branched on tool annotations, or it missed a writer that bypasses the queue (`bank_sync`, `budgets_export`, `budgets_switch`, `session_close`), so a "read-only" deployment could still write.
- Filtered tools were left out of `tools/list` but could still be called by name. Or the filter was applied per transport, or inside `buildToolListEntries` (which `fetchCapabilities` calls one tool at a time), rather than at the one name source every consumer shares, and the `tools/list` paths, `fetchCapabilities` and `server_info` drifted apart again (#379).
- The default changed. An existing deployment with no new variables lost tools or saw a reordered list after upgrading.
- The rules batch went around `queueWriteOperation`, or its description implied atomicity. A failure partway through a batch then left a partial write the model believed was rolled back. Or it retried a create, and a slow first attempt that had landed produced a duplicate rule.
- A batch tool in the `chat` preset still reported success for a write that never happened: `budget_updates_batch` counting an unknown category as `successful` (#516), or `transactions_update_batch` turning a validation error into a fake item failure (#517). The preset then concentrates clients on the least trustworthy tools.
- Schema trimming in #486 loosened a Zod constraint while cutting prose, so inputs the tool used to reject are now accepted.
- The size ceiling was measured before #485's new tool and #516's schema change landed and had to be raised in the next commit. Order: #517 and #516, then #485, then #483, then #486.
- Work collided with the outside contributor, who claimed and delivered #484 and #489. On 2026-10-08 the maintainer took all five remaining tickets, and #477 says so; a later claim on any of them is answered before work on it starts.
- The phase stalled because the `chat` preset waited for a tool that never shipped. If #485 slips, ship the preset without that tool and extend it later. Do not extend the phase to wait for it.

## Expected work

Not binding. These are the tickets this phase expects to need:

1. #517: `transactions_update_batch` reports validation and whole-call errors as errors (small; found in the 2026-10-08 phase review).
2. #516: `budget_updates_batch` moves into an adapter method with the category and month guards, per-item results, and an integer, capped schema (found in the same review).
3. #485: `actual_rules_create_batch` and the README Batch Operations section. The audit is done; no transfer batch.
4. #483: toolsets, the allowlist, read-only mode and the `chat` preset (re-measured 2026-10-08).
5. #486: trim the six heaviest schemas and add the `tools/list` size budget test, after 2 and 3.
#477, the umbrella, is closed: a split closes the original and names its successors, so it does not wait for them.

## Out of scope

- `actual_budgets_transfer_batch`: not planned. A rebalance is a set of absolute targets, done as one `actual_budget_updates_batch` call after a read; a pairwise transfer batch would be order-dependent (decided in the #485 audit).

- Consolidating or deprecating the `actual_transactions_search_*` read tools: Backlog. Needs usage numbers first, and it would break desktop users (see the 2026-09-29 reply on #477). No ticket until there is evidence.
- Dynamic toolsets (a tool list that changes mid-conversation): not planned. It invalidates the provider's prompt cache, and client support for `tools/list_changed` is patchy.
- Per-principal toolsets keyed on the OIDC user: Backlog, no ticket yet.
- Dashboard and widget tools: Backlog, blocked on actualbudget/actual#8981.
