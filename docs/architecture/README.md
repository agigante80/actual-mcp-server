# Architecture decisions

This folder holds the project's architecture decision records (ADRs). For components, transports and data flow see [../explanation/architecture.md](../explanation/architecture.md).

An accepted ADR is immutable: a change to it is recorded as a new ADR that supersedes it.

## ADR index

| ADR | Title | Status | Decision (one line) |
|---|---|---|---|
| [0001](0001-pr-per-code-ticket-trial-for-coderabbit-review.md) | Trial: the maintainer's code tickets land through a pull request to develop so CodeRabbit reviews them | superseded | For the next five code tickets, land through a short-lived branch and a PR to develop with one advisory CodeRabbit round; docs, bumps and releases stay direct |
| [0002](0002-keep-the-pr-flow-for-code-tickets-maintainer-docs-stay-direct.md) | Keep the pull request flow for the maintainer's code tickets; maintainer docs stay direct | accepted | Maintainer tickets touching src/ or tests/ land through a t/<issue>-<slug> branch and a PR to develop with one advisory CodeRabbit round, rebase merged; maintainer docs, bumps, audit records and releases stay direct; outside PRs are reviewed whatever they touch |
| [0003](0003-experimental-upstream-surfaces-are-published-only-when-named-in-mcp-experimental.md) | Tools on an experimental upstream surface are published only when named in one list variable, MCP_EXPERIMENTAL | superseded | Experimental upstream surfaces are published only when the operator names the feature in MCP_EXPERIMENTAL (comma list, empty by default); each name maps to a toolset, an unknown name refuses startup, a graduated name stays accepted; the variable gates publication only and the per-budget upstream flags are still checked on every write |
| [0004](0004-internal-send-seam-and-feature-disabled-refusal-move-to-ticket-2.md) | The internal-send adapter seam and FeatureDisabledRefusal move from ticket 1 to ticket 2 of the budget automations reimplementation | accepted | The internal-send adapter seam (closed allow-list of upstream handlers) and FeatureDisabledRefusal move from ticket 1 (issue 840) to ticket 2 (issue 841), where they get their first real caller; ticket 1 keeps the MCP_EXPERIMENTAL gate, the canary test and the read tool; the rest of ADR 0003 stands |
