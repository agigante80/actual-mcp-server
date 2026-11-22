# Architecture decisions

This folder holds the project's architecture decision records (ADRs). For components, transports and data flow see [../explanation/architecture.md](../explanation/architecture.md).

An accepted ADR is immutable: a change to it is recorded as a new ADR that supersedes it.

## ADR index

| ADR | Title | Status | Decision (one line) |
|---|---|---|---|
| [0001](0001-pr-per-code-ticket-trial-for-coderabbit-review.md) | Trial: the maintainer's code tickets land through a pull request to develop so CodeRabbit reviews them | superseded | For the next five code tickets, land through a short-lived branch and a PR to develop with one advisory CodeRabbit round; docs, bumps and releases stay direct |
| [0002](0002-keep-the-pr-flow-for-code-tickets-maintainer-docs-stay-direct.md) | Keep the pull request flow for the maintainer's code tickets; maintainer docs stay direct | accepted | Maintainer tickets touching src/ or tests/ land through a t/<issue>-<slug> branch and a PR to develop with one advisory CodeRabbit round, rebase merged; maintainer docs, bumps, audit records and releases stay direct; outside PRs are reviewed whatever they touch |
