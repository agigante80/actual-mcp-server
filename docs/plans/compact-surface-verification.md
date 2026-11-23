# Plan: Compact surface verification

## Goal

Prove by hand that the 15 compact tools and the five MCP prompts do what their descriptions say, against a live Actual server, and that the descriptions agree with the official Actual API documentation. The compact surface replaced the legacy one as the default in v0.30.0 and has only ever been checked through the automated suites, which were written by the same hands that wrote the tools. This phase tests it the way a user's model would: from `tools/list` and `prompts/list` alone, on develop `5b8d59ec` (v0.35.2, `@actual-app/api` 26.11.0), on the disposable test budget.

## Done looks like

- One campaign ticket per tool group and one for the prompts, each closed with a record of what was called, what came back, and which findings it produced.
- Every action and every route of every compact tool has been called at least once with a valid input and once with an invalid one, over HTTP, and a sample over stdio.
- Every description sentence that states a fact (a default, a limit, a unit, a refusal, what a field means) has been checked against the code, the live result, or the official documentation at actualbudget.org/docs/api.
- Every prompt has been fetched with each argument shape, and each numbered step of its text has been executed as written against the live server.
- Each finding has exactly one outcome: fixed in a pull request with a test that was red first, filed as its own ticket, or dropped with one line. Small documentation errors are fixed directly.
- Fixes land through `t/<issue>-<slug>` branches and pull requests against `develop`. The phase ends with a green Docker E2E full run and `bash scripts/deploy-and-test.sh full` green over HTTP and stdio with zero residue, a release to `main`, and a tool by tool read of the Glama listing recorded in the outcome.
- The prompts ticket ends with a written comparison against what other finance MCP servers on Glama offer and against current MCP prompt guidance, with each suggested improvement filed as its own ticket.

## Fails if

Premortem (written by the agent on 2026-11-23, the user being away; they asked for the campaign to be organised and started without them): the phase is over and it failed badly. What happened?

- The testers read the unit tests and the source, saw that they agreed, and called that testing. Nothing was run against a live server, so the defects the suites cannot see stayed unseen.
- Findings were reported by subagents and ticketed without being reproduced, and half of them were phantoms (the control-before-causal-claim lesson).
- Testing ran against the real budget on port 3600 instead of the disposable one on 3601, or left `ADHOC` accounts, payees and rules behind, and the next release gate went red on residue.
- Parallel testers shared one budget and read each other's writes as defects, or tripped the Actual login or request rate limit and reported the lockout as a server bug.
- A description was "corrected" to match the official documentation where our tool deliberately differs (integer cents, the compact field names), making it wrong for our server.
- Description fixes made the texts longer and broke a size ceiling, or a Glama per-tool score dropped and only the headline was read.
- The fix train chained: each fix's review filed new tickets and the night ended with more open tickets than findings (the review-loop rule).
- A prompt improvement copied a competitor's idea that needs an operation Actual does not offer.
- The release went out with HTTP-only evidence, or Glama never built it.

## Expected work

Not binding. In order:

1. Refresh the local environment and build a shared call harness for the testers.
2. Campaign tickets: context and lookup; reading and reports; budget months; transactions; accounts and categories; payees, tags and rules; schedules and budget files; cross-cutting (schemas, errors, instructions, resource, stdio); prompts.
3. Reproduce and triage every finding; fix the small ones directly.
4. Implement the fix tickets in priority order, one pull request each.
5. Full runs, release, Glama review, phase close.

## Out of scope

- The legacy surface as such (it is tested only where a compact action exposes its behaviour) and its removal (#682).
- #704 to #708, which wait for `@actual-app/api` 26.12.0.
- Operations the Actual API does not offer.
- Bank sync against a real provider, and anything on the real budget.
