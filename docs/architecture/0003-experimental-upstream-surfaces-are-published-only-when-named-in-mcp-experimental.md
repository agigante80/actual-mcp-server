# 0003. Tools on an experimental upstream surface are published only when named in one list variable, MCP_EXPERIMENTAL

- Status: superseded
- Date: 2026-11-25
- Superseded by: 0004

## Context

Outside pull request 837 (58 files, +1944) adds 4 tools for budget automations, which is Actual's experimental Goal templates feature. The tools sit on upstream's internal handler bus (`api.internal.send` with `budget/...` handlers) and on raw columns (`goal_def`, `cleanup_def`, `cleanup_groups`). None of that has a public API, and it belongs to a feature that upstream documents as experimental and possibly removable.

As submitted the tools are always published. That raises the legacy tools list by about 7,500 bytes and the compact list by about 1,200 bytes for every deployment, whether or not the operator uses the feature.

The tool list is built at startup, before any budget is open, and the upstream flag is per budget. Publication therefore cannot follow the budget flag.

## Options considered

### A. A new config variable per experimental feature

- Pros: explicit, easy to explain.
- Cons: config sprawl; three synced edits per feature (`src/config.ts`, `.env.example`, `docs/reference/configuration.md`); a dead variable to deprecate at each graduation.

### B. One boolean for all experimental features

- Pros: simplest; one variable forever.
- Cons: an operator who enabled it for one feature silently gets every future experimental feature on upgrade, write tools included.

### C. One variable holding a list of feature names (chosen)

- Pros: one variable forever; each feature is still chosen by name; an upgrade never enables something unasked; matches Kubernetes feature gates and this project's own list variables.
- Cons: a little more to build once (name validation, graduation rule).

### D. Reuse MCP_TOOLSETS with experimental toolsets that `all` excludes

- Pros: no new variable; the machinery exists.
- Cons: `all` would no longer mean all; the interaction with presets is unchecked.

## Decision

Tools that depend on an experimental or unpublished upstream Actual Budget surface are published only when the operator names the feature in ONE list-valued config variable, `MCP_EXPERIMENTAL` (a comma list of feature names, empty by default).

- Each feature name maps to a named set of legacy tools declared in `src/lib/toolsets.ts`, which `all` does not select, so the existing hiding logic applies to both the legacy and the compact surface: a compact action is hidden when its legacy tool is not published.
- An unknown name refuses startup, as `MCP_TOOLSETS` does.
- When a feature graduates, its tools join the normal toolsets. The old name stays accepted, with a log line saying it is no longer needed.
- The variable gates PUBLICATION only. The per-budget upstream flags (`flags.goalTemplatesEnabled`, `flags.goalTemplatesUIEnabled`) are still checked on every write.

The first user is the budget automations feature from outside pull request 837. It is reimplemented on `develop` in three tickets:

1. The gate, the internal-send adapter seam, the `FeatureDisabledRefusal`, an upstream-surface canary test and the read tool `categories_get_automations`.
2. `budgets_apply_templates` and `budgets_run_cleanup`.
3. `categories_set_automations`, held until ticket 2 has shipped.

## Consequences

- A deployment that does not name a feature in `MCP_EXPERIMENTAL` publishes none of its tools, on either surface, so its tool lists do not grow.
- One variable serves every experimental feature; a new feature adds a name and a toolset, not a variable.
- An upgrade never enables an experimental feature the operator did not name.
- Name validation and the graduation rule have to be built once.
- A graduated name remains accepted, so an operator's configuration keeps starting after graduation.
- Deferred: ticket 3 (`categories_set_automations`) waits until ticket 2 has shipped.

## Sources

- `src/lib/toolsets.ts`
- https://github.com/agigante80/actual-mcp-server/pull/837
- https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/
- https://github.com/orgs/ModelContextProtocol-Security/discussions/3
- https://actualbudget.org/docs/experimental/goal-templates/

## Revisit when

- Ticket 2 has shipped: ticket 3 (`categories_set_automations`) can then start.
- Upstream graduates Goal templates or publishes a public API for it: revisit the whole gate.
- This stays the only experimental feature for a year: revisit the whole gate.
