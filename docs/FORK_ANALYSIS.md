# Fork analysis

Tracks every fork of `agigante80/actual-mcp-server` and what functionality each
fork has that upstream does not, as a source of ideas to implement. Regenerated
by the `fork-analysis` skill (`.claude/skills/fork-analysis/`). A fork is
re-analysed only when its head sha changes since the row below; otherwise the
recorded verdict stands, so the work is not repeated.

**Last run:** 2026-06-07 (UTC)  |  **Upstream baseline:** `main` @ `277345a` (v0.6.37; develop at v0.6.39)

## Forks

| Fork | Branch | Ahead | Behind | Fork pushed_at | Analysed head | Analysed on | Verdict |
|------|--------|------:|------:|----------------|---------------|-------------|---------|
| [rune42808/actual-mcp-server](https://github.com/rune42808/actual-mcp-server) | main | 0 | 62 | 2026-06-04 | `ec49fd4` | 2026-06-07 | no divergence (snapshot of an upstream commit) |
| [lsl9119/actual-mcp-server](https://github.com/lsl9119/actual-mcp-server) | main | 0 | 131 | 2026-04-29 | `5cc48bb` | 2026-06-07 | no divergence (snapshot) |
| [iflow-mcp/agigante80-actual-mcp-server](https://github.com/iflow-mcp/agigante80-actual-mcp-server) | main | 0 | 270 | 2026-03-17 | `8ffeb8a` | 2026-06-07 | no divergence (mirror) |
| [ahmadrazach/actual-mcp-server](https://github.com/ahmadrazach/actual-mcp-server) | main | 1 | 443 | 2026-02-07 | `8460876` | 2026-06-07 | novel: dynamic budget auto-select / routing |
| [ZanzyTHEbar/actual-mcp-server](https://github.com/ZanzyTHEbar/actual-mcp-server) | main | 315 | 270 | 2026-03-21 | `f555255` | 2026-06-07 | novel: semantic/hybrid search, LDAP auth, worker-thread sessions, OpenAPI tool codegen, meta-tool registry |

Three of the five forks (rune42808, lsl9119, iflow-mcp) are zero commits ahead of
upstream: they are point-in-time snapshots or mirrors with nothing of their own.
They are recorded so the next run cache-skips them; nothing to harvest.

## Per-fork detail (diverged forks only)

### ahmadrazach/actual-mcp-server  (analysed 2026-06-07, head `8460876`)

- What diverged: a single feature commit, "Implement dynamic budget selection and routing".
- Novel functionality upstream lacks:
  - **Dynamic budget auto-select / routing** (`src/tools/budgets_auto_select.ts`, `src/utils/budget-router.ts`, `tests/unit/budget_router.test.ts`): a tool plus a router that chooses/routes the active budget for an operation automatically, rather than requiring an explicit `actual_budgets_switch`. Idea value: medium. Overlaps our existing multi-budget support (`actual_budgets_switch`, per-session budget state, and the #189 per-principal budget preference), but auto-routing by operation/context is a distinct angle.
- Noise (ignored): none beyond the lockfile and the tsconfig-paths script tweak.

### ZanzyTHEbar/actual-mcp-server  (analysed 2026-06-07, head `f555255`)

The largest and most interesting fork (315 commits ahead, 228 files). Important:
a large share of those commits are NOT features. Many are type-hardening
("replace 'as any'", "refine zod inputSchemas", "reduce any sites"), schema/test
refinement, CI plumbing, and merges of the upstream owner's own roadmap branches.
Those are noise for idea-harvesting. The genuinely novel subsystems are:

- **Semantic / hybrid search over budget data** (`src/lib/search/*`, tools
  `hybrid_search.ts`, `search_similar.ts`, `search_index_info.ts`): an
  embeddings-based search layer with a hybrid keyword+vector engine, an embedding
  pipeline + index + sync state, query expansion/analysis, and a response cache
  with invalidation. Pluggable embedding providers: Ollama (local), HuggingFace
  (local), and OpenAI-compatible. Idea value: HIGH (natural-language search and
  "find similar transactions" is a strong AI-budgeting feature). Effort: LARGE
  (embedding infra, optional heavy deps, indexing/sync lifecycle). We have none of
  this; closest upstream feature is `actual_query_run` (structured ActualQL).
- **Pluggable auth with an LDAP provider** (`src/auth/auth-factory.ts`,
  `auth-middleware.ts`, `ldap-provider.ts`, `oidc-provider.ts`, `types.ts`): an
  auth-factory abstraction over multiple providers, adding LDAP alongside OIDC.
  Idea value: medium (enterprise/self-host auth). Effort: medium. Upstream has
  OIDC + static bearer but no LDAP and no provider-factory abstraction.
- **Worker-thread session model + write coordinator** (`src/lib/SessionWorkerManager.ts`,
  `WriteCoordinator.ts`, `src/workers/actualSessionWorker.ts`): runs Actual
  sessions in worker threads with a dedicated write coordinator. Idea value:
  medium-high and architecturally relevant: it is a different answer to the same
  session/concurrency problem upstream solves with `ActualConnectionPool` + the
  `withApiLock` mutex (see #134, and the #173 session-recovery discussion). Effort:
  LARGE and high-risk (it would replace the core session engine). Worth studying
  as a design reference even if not adopted wholesale.
- **OpenAPI-driven tool generation** (`scripts/generate-tools.ts`,
  `scripts/generate-tools-node.js`, `scripts/openapi/actual-openapi.yaml`, plus a
  `generator-check` CI workflow): generates tool stubs from an OpenAPI spec of the
  Actual API and verifies they stay in sync. Idea value: medium (cuts the
  per-tool boilerplate and keeps tools aligned with the API). Effort: medium.
  Upstream generates client TYPES (`generated/actual-client/types.js`) but not
  tool stubs.
- **Meta-tool registry + dynamic dispatch** (`src/tools/meta_registry.ts`,
  `meta_tool_call.ts`): a meta-tool that lists and invokes other tools
  dynamically. Idea value: medium (helps clients that cap tool counts; one meta
  tool can front many). Effort: medium. Upstream registers tools statically.
- **Tool-name normalization** (`src/lib/toolNameNormalization.ts`): rewrites tool
  names (dots to underscores) for OpenAI-API compatibility. Idea value: LOW for
  upstream: our tools already use underscore names (`actual_x_y`), so this is
  largely moot for us. Recorded for completeness.
- Lower-value or likely-superseded helpers: a standalone `src/server/sseServer.ts`
  (upstream's StreamableHTTP transport already carries SSE), and utility modules
  `cachedRefs.ts`, `lookupByName.ts`, `budgetContext.ts`, `wrapToolCall.ts`,
  `toolResult.ts` (caching / name-lookup / tool-call wrapping that partly overlap
  upstream's adapter, `actual_get_id_by_name`, and `toolFactory`).
- Noise (ignored): the large "replace as any" / "refine zod schema" / "reduce
  any" type-hardening series, CI plumbing, doc pruning, and merges of upstream
  roadmap branches. Not features.

## Feature ideas backlog (harvested from forks)

Deduplicated candidate features worth considering for upstream. Not commitments;
hand a chosen one to the ticket-creation flow when ready.

| Idea | From fork | Value | Effort | Notes / overlap with existing |
|------|-----------|:-----:|:------:|-------------------------------|
| Semantic / hybrid search over transactions (embeddings, "find similar", NL search) with pluggable Ollama/HF/OpenAI providers | ZanzyTHEbar | high | L | No upstream equivalent; `actual_query_run` is structured-only. Heaviest item; optional-dep gated. |
| OpenAPI-driven tool-stub generation + generator-check CI | ZanzyTHEbar | med | M | We generate client types but not tool stubs; would cut per-tool boilerplate and keep tools in sync with the API. |
| Meta-tool registry + dynamic tool dispatch (one tool fronts many) | ZanzyTHEbar | med | M | Helps clients with tool-count caps; we register 70 tools statically. |
| Pluggable auth factory + LDAP provider | ZanzyTHEbar | med | M | We have OIDC + bearer; adds LDAP and a provider abstraction for self-host/enterprise. |
| Worker-thread session model + write coordinator | ZanzyTHEbar | med-high | L | Design reference for the session/concurrency engine (cf. #134, #173); high risk to adopt, high value to study. |
| Dynamic budget auto-select / routing by operation context | ahmadrazach | med | S-M | Extends our multi-budget switch + #189 preference with automatic routing. |
| Tool-name normalization for OpenAI API compatibility | ZanzyTHEbar | low | S | Largely moot: our tool names already use underscores. |

## How this file is maintained

Run the `fork-analysis` skill (ask to "analyse the forks" or "scan forks for
features"). It re-checks divergence for every fork, re-analyses only those whose
head sha changed since the rows above, carries forward unchanged verdicts, and
rewrites this file. It never clones or runs fork code; it reads the GitHub API
and file contents only.
