# Plan: Compact tool surface

## Goal

Build a second, small public tool surface next to the existing 85 tools: 15 tools with no `actual_` prefix, named `verb_noun` in snake_case, each fronting a group of existing tools through one dispatcher. It is opt-in through `MCP_TOOL_SURFACE=compact` in this phase, so nothing changes for a current installation. The reason is Glama's server coherence score (v0.28.0: Disambiguation 2, Naming 4, Tool Count 1, Completeness 5). Its rubric gives Tool Count 5 only to "typically 3-15 tools" and Naming 5 only to a "consistent verb_noun pattern throughout", and a competing Actual server with 11 `verb_noun` tools scores 5 on all four. The design record (#670) holds the mapping of all 85 tools and the sources.

## Done looks like

- #670: `docs/explanation/compact-tool-surface.md` holds the 85-row mapping, the flat schema of each of the 15 tools and the decision record that supersedes #654 and the "keep, sharpen" conclusion of #653.
- #671: `MCP_TOOL_SURFACE` accepts `legacy` (default), `compact` and `all`; `tools/list` follows it on HTTP and stdio; under `MCP_READ_ONLY` no `manage_*` tool is listed or callable; `verify-tools`, `tool-count` and the size guard pass on both surfaces.
- #672 to #678: all 15 compact tools exist, each (tool, action) reaching exactly one legacy tool, with unit tests (positive and negative) and Docker E2E rows over HTTP and stdio. A parity test proves every legacy tool except the two session tools is reachable through exactly one compact (tool, action).
- #679: the local TDQS harness scores the compact list at coherence 5 on all four dimensions and no tool below 4.0, or the remaining gap is written down with its reason in `docs/audit/tdqs-baseline.md`.
- The legacy surface is byte-identical in `tools/list` to v0.28.0 apart from intended changes, and the default stays `legacy`.
- `tests/e2e/run-docker-e2e.sh full` and `bash scripts/deploy-and-test.sh full` are green on the final HEAD (chained, never in parallel) with zero residue, then a minor release to `main`.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- A compact tool mapped an action to the wrong legacy tool or dropped a field on the way, and a write did something other than what the caller asked: a delete where a close was meant, an amount lost, a batch applied partly. The unit tests passed because they asserted the mapping the author wrote, not the effect.
- The compact layer opened its own adapter session or called the adapter directly, and writes stalled for 30 seconds under load (the never-nest deadlock).
- `MCP_READ_ONLY` or the budget ACL was enforced on the legacy name only, and a compact tool wrote in a read-only deployment.
- The flat schemas were so loose that a model could not tell which fields an action needs; per-tool TDQS fell below the legacy minimum and the overall Glama score went down although coherence went up.
- The 15 descriptions overlapped again (`get_context` against `list_entities`, `search_transactions` against `summarize_transactions`) and Disambiguation stayed at 3.
- The local scorer said 5 and Glama said 3, because the local judge is a different model and nobody treated its verdict as an estimate.
- The default surface changed by accident in this phase and every existing client lost its tool names in a minor release.
- Adding 15 tools pushed `tools/list` under `all` past a client limit, or the size guard was raised without a measurement.

## Expected work

Not binding. In order:

1. #670 the design record, then #671 the infrastructure.
2. #672, #673, #674: the six read tools.
3. #675 to #678: the nine write tools.
4. #679: score, tune descriptions, record.
5. The two local full runs on the final HEAD, then a minor release.

## Out of scope

- Changing the default surface, remapping toolsets and the chat preset, and migrating the test suites (#680, #681: next phase).
- MCP prompts and the README work (#660 to #669: next phase).
- Removing the legacy surface (#682) and the camelCase aliases (#657).
- The `payees_update` category bug (#651): the compact tool inherits today's behaviour.
- Triggering a Glama rebuild: only the maintainer can do that in the Glama admin page.
