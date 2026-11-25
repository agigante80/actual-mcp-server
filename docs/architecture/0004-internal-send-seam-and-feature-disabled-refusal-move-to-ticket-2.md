# 0004. The internal-send adapter seam and FeatureDisabledRefusal move from ticket 1 to ticket 2 of the budget automations reimplementation

- Status: accepted
- Date: 2026-11-25
- Supersedes: 0003 (in part: only items 1 and 2 of the ticket split in its Decision section; the rest of 0003 is restated below and stands)

## Context

ADR 0003 splits the reimplementation of the budget automations feature (outside pull request 837) into three tickets. Its ticket 1 (issue 840) carries the `MCP_EXPERIMENTAL` gate, the internal-send adapter seam, the `FeatureDisabledRefusal`, an upstream-surface canary test and the read tool `categories_get_automations`. Its ticket 2 (issue 841) carries `budgets_apply_templates` and `budgets_run_cleanup`.

The internal-send adapter seam is the single adapter function allowed to call upstream `api.internal.send` handlers, with a closed allow-list of handler names.

A live probe on 2026-11-25 (calling `@actual-app/api` 26.11.0 directly against a disposable Actual 26.11.0 server) showed that the whole read path works with an AQL read of `categories` (`template_settings`, `goal_def`, `cleanup_def`) and `cleanup_groups` plus the category note, with zero internal sends. The ticket gate on issue 840 (round 1, item 2) had already flagged that the read path needs no internal send.

With the seam in ticket 1 it would ship with no caller, which `npm run knip` (blocking in CI) reports as dead code.

The read tool also works with the budget flags off: the upstream handlers ignore the flags, which only gate the UI. `FeatureDisabledRefusal` therefore has no thrower in ticket 1.

## Options considered

### A. Keep the seam in ticket 1 (as ADR 0003 says)

- Pros: no new ADR; the allow-list exists before any write ticket starts.
- Cons: ticket 1 ships code nothing calls, so knip fails or it needs a fake caller; the gate flagged it.

### B. Move the seam and the refusal to ticket 2 (chosen)

- Pros: they land with their first real caller and are tested by real use; ticket 1 becomes a pure read with no new risk surface.
- Cons: one more ADR; ticket 2 grows a little.

### C. A fourth ticket only for the seam

- Pros: smallest review per ticket.
- Cons: same dead-code problem as A, plus one more ticket and gate round.

## Decision

The internal-send adapter seam (the single adapter function allowed to call upstream `api.internal.send` handlers, with a closed allow-list of handler names) and the `FeatureDisabledRefusal` typed refusal move from ticket 1 (issue 840) to ticket 2 (issue 841), where they get their first real caller.

The budget automations feature is reimplemented on `develop` in three tickets:

1. Issue 840: the `MCP_EXPERIMENTAL` gate, the upstream-surface canary test and the read tool `categories_get_automations`.
2. Issue 841: the internal-send adapter seam, the `FeatureDisabledRefusal`, `budgets_apply_templates` and `budgets_run_cleanup`.
3. `categories_set_automations`, held until ticket 2 has shipped (unchanged from ADR 0003).

Everything else in ADR 0003 stands. It is restated here so that it stays in force when 0003 is marked superseded:

- Tools that depend on an experimental or unpublished upstream Actual Budget surface are published only when the operator names the feature in ONE list-valued config variable, `MCP_EXPERIMENTAL` (a comma list of feature names, empty by default).
- Each feature name maps to a named set of legacy tools declared in `src/lib/toolsets.ts`, which `all` does not select, so the existing hiding logic applies to both the legacy and the compact surface: a compact action is hidden when its legacy tool is not published.
- An unknown name refuses startup, as `MCP_TOOLSETS` does.
- When a feature graduates, its tools join the normal toolsets. The old name stays accepted, with a log line saying it is no longer needed.
- The variable gates PUBLICATION only. The per-budget upstream flags (`flags.goalTemplatesEnabled`, `flags.goalTemplatesUIEnabled`) are still checked on every write.

## Consequences

- Ticket 1 is a pure read with no new risk surface: no internal send, no new refusal type.
- The seam and the refusal land with their first real caller in ticket 2 and are tested by real use, so nothing ships that knip reports as dead code.
- Ticket 2 grows a little.
- The allow-list of internal handler names does not exist until ticket 2.
- One more ADR; once this one is accepted, 0003 is marked superseded and this record carries its standing decision.

## Sources

- `docs/architecture/0003-experimental-upstream-surfaces-are-published-only-when-named-in-mcp-experimental.md`
- https://github.com/agigante80/actual-mcp-server/issues/840
- https://github.com/agigante80/actual-mcp-server/issues/841
- https://github.com/agigante80/actual-mcp-server/pull/837

All checked 2026-11-25.

## Revisit when

- Implementing ticket 1 shows that a read does need an internal handler (the stored shape of a category saved from the Actual web automations editor is not yet observed): the seam returns to ticket 1.
