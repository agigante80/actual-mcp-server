# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Actual MCP Server** bridges AI assistants with [Actual Budget](https://actualbudget.org/) via the Model Context Protocol (MCP), exposing **74 tools** for conversational financial management. Supports two transports: **HTTP** (for LibreChat/LobeChat/multi-user deployments) and **stdio** (for Claude Desktop/Claude Code local use; pass the `--stdio` flag).

**Tech Stack**: TypeScript (NodeNext/ESM), Node.js 22+, `@actual-app/api` v26, `@modelcontextprotocol/sdk`, Express 5, Zod v4, Playwright

## Output Convention: never use em or en dashes

**Hard project rule. Applies to ALL output: chat, commits, GitHub comments and PR/issue bodies, file content, code comments, release notes.** Never write the unicode em dash character (U+2014) or en dash character (U+2013).

When you would have written one, restructure the sentence so no dash is needed at all. Do NOT substitute with a regular ASCII hyphen (the hyphen is reserved for genuine compound words like `post-merge`, `cherry-pick`, `off-budget`).

Replacement patterns:
- Introducing an explanation or list: use a colon. "Result: it shipped."
- Parenthetical aside: use commas or parentheses. "The fix, cherry-picked, landed cleanly." Or "The fix (cherry-picked) landed cleanly."
- Range: use the word "to" or "through". "v0.6.4 to v0.6.6", "Monday through Friday".
- Strong pause or contrast: split into two sentences.

Mechanical enforcement: a PreToolUse hook at `.claude/hooks/block-dashes.py` (forge-kit canonical `block-dashes-version: 1`, registered in `.claude/settings.local.json`) blocks any `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, or `Bash` tool call whose payload contains an em or en dash, and tells the model how to restructure. The hook script's output is shown back to the model verbatim. Self-check before submitting tool calls regardless of whether the hook is currently armed.

Common slip patterns to watch for (described abstractly to avoid the literal characters):
- Tables that use a wide horizontal-bar punctuation as a separator inside cells (replace with a colon, or restructure into a sub-table).
- A definitional pause like `X PAUSE Y` where PAUSE is a wide horizontal bar (use `X: Y` instead).
- Range expressions like `X PAUSE Y` where PAUSE is a wide horizontal bar (use `X to Y`).
- Bulleted lists in the form `- item PAUSE description` where PAUSE is a wide horizontal bar (use `- item: description`).

## Git Workflow

**Always work on `develop`, never push directly to `main`.**

- All changes go to the `develop` branch
- Push to `origin/develop` after every commit
- `main` is only updated with explicit user permission (e.g. "push to main" or "release")
- When the user says "push to github" without specifying a branch → push to `develop`

**The `main` rule is enforced mechanically, not just by convention.** A `PreToolUse(Bash)` hook, `.claude/hooks/require_green_develop_before_main.py` (registered in `.claude/settings.local.json`), inspects every Bash command and BLOCKS any git merge, push, or release-tag push that targets `main` unless `origin/develop` is both version-bumped past the latest published `vX.Y.Z` tag and green in GitHub Actions at its HEAD sha. It fails CLOSED: if it cannot verify (no network, `gh` missing or unauthenticated, no CI run found), it blocks. Do not attempt to route around it; fix the underlying condition (bump the version, get CI green) or ask the user.

**A promotion to `main` REQUIRES a passing full integration run over BOTH transports (`MCP_TEST_TRANSPORT=http` and `MCP_TEST_TRANSPORT=stdio`) with a green zero-residue assertion.** Run `bash scripts/deploy-and-test.sh full`; it writes `.release/dual-transport-report.json`, which the `release` skill verifies against the develop HEAD sha. HTTP-only evidence is not sufficient: stdio is the transport half our Claude Desktop users run on, and it had no write-path coverage until #280.

**Incoming tickets are hypotheses, not ground truth.** For a `bug` or any
behaviour-change ticket (especially external or spec-derived ones), reproduce the
reported behaviour against the CURRENT code before writing a fix (the
`implement-ticket` skill's "Reproduce first" phase, ideally via `/local-env`). If
it does not reproduce, recharacterise or close it rather than fixing a phantom; if
it reproduces differently, rewrite and re-gate. A behaviour change is not done
until a check that was red is green. Test rigor (scenarios, unit + E2E tests) is
the maintainer's responsibility enforced by the gate, NOT something an external
reporter must provide: the issue templates ask reporters only for what they know.

## Commands

```bash
# Build & Run
npm run build                   # TypeScript compilation (required before running)
npm run dev -- --http           # Dev mode with HTTP transport (see note below: --debug is already implied)
npm run dev -- --stdio          # Dev mode with stdio transport (for Claude Desktop/Code)
npm run start                   # Production HTTP (requires build first)
node dist/src/index.js --stdio  # Production stdio

# Testing (validation sequence, run in this order)
npm run build                   # Step 1: must compile cleanly
npm run verify-tools            # Step 2: all 74 tools registered (reads dist/)
npm run test:unit-js            # Step 3: unit + schema tests
npm audit --audit-level=moderate # Step 4: no new vulnerabilities

# Individual test commands
npm run test:adapter            # Adapter: retry, concurrency, init/shutdown
node tests/unit/transactions_create.test.js   # Single unit test file
npx playwright test --grep "initialize -> tools/list"  # Single E2E test
npm run test:e2e                # Full Playwright E2E (requires no live server)
npm run test:integration:smoke  # Live server integration (levels: sanity < smoke < normal < extended < full < cleanup)
npm run test:integration:full:stdio  # Same suite over stdio (also :normal:stdio, :extended:stdio); equivalent to MCP_TEST_TRANSPORT=stdio
npm run test:e2e:docker:smoke   # Playwright E2E inside the docker-compose.test.yaml stack (also :docker, :docker:full)
npm run test:all                # Convenience: adapter + unit + docker:smoke (no live server needed)

# Drift guards (all CI-gated; run after touching the thing they guard)
npm run config-drift            # config.ts schema + RAW_ENV_ALLOWLIST vs .env.example vs README env table
npm run node-version-drift      # Node version pinned consistently across Dockerfile, workflows, package.json engines
npm run tool-count              # Total-tool-count literals across docs/tests/constants
npm run version:check           # VERSION vs package.json vs published tags
npm run actionlint              # Workflow lint; installs a digest-pinned actionlint first (see Lint Code below)

# Deploy (Docker required; see also /local-env)
npm run deploy:smoke            # scripts/deploy-and-test.sh smoke
npm run deploy:full             # Full dual-transport run; writes .release/dual-transport-report.json (release gate evidence)

# Tools
npm run verify-tools            # Verify tool count + registration
npm run tool-count              # CI-gated drift check (#193): rewrites stale total-count literals across docs/tests/constants with --fix; canonical = IMPLEMENTED_TOOLS length. Does NOT touch `**Tool Count:**` markers (version-bump.js owns those)
npm run check:coverage          # List @actual-app/api methods vs tool coverage
npm run knip                    # Dead-code detection (#234): unused files/exports/types via the committed knip.json. Blocking since #237: `knip` exits nonzero on any dead code and FAILS the Lint Code CI job. Run the /code-health-auditor skill for triage + ticketing.
npm run test:mcp-client         # Connect as MCP client and exercise tools

# Manual connection tests (requires .env)
npm run dev -- --test-actual-connection  # Test Actual Budget connection only
npm run direct-sync             # Diagnostic: connect to Actual + run bank sync per account, bypassing the MCP layer (scripts/direct-sync/bank-sync-direct.mjs). Reads the same ACTUAL_*/BUDGET_n_* env vars. Flags: --budget <name>, --list/--dry-run, --no-file-log

# Docker
docker compose --profile dev up         # Hot-reload dev (app on :3600)
docker compose --profile production up  # Production: MCP server on :3600
# docker-compose.yaml defines only the dev and production profiles (no nginx, no bundled Actual server).
# For a stack that also runs Actual Budget, use docker-compose.test.yaml (it + playwright.config.docker.ts back the test:e2e:docker* scripts).
```

**`npm run dev` is not a bare runner.** It is `npm run build && node scripts/register-tsconfig-paths.js -- --debug`, so it always recompiles first and always appends `--debug`. Anything you pass after `--` lands AFTER that flag, which is why the transport flag alone is enough. Passing `--debug` yourself is harmless but redundant. There is no watch mode: re-run the command to pick up a source change.

**The build is TypeScript 7 with `noUnusedLocals` and `noUnusedParameters` on.** An unused import, local, or parameter is a hard `npm run build` failure, not a lint warning; prefix a deliberately-unused parameter with `_`. `tsconfig.json` also redirects `@actual-app/core` and `@actual-app/core/*` to the stub at `types/actual-core-stub.d.ts`. That stub is load-bearing: from `@actual-app/api` v26.4.0 the core package is imported directly and ships TypeScript SOURCE rather than compiled declarations, so without the redirect `tsc` compiles it under our `strict` settings and fails on code that needs `typescript-strict-plugin`. If you hit a type error pointing into `@actual-app/core`, the stub is the thing to look at, not the calling code. Note `types/` is in the do-not-modify tier below, so changing it needs explicit permission.

**Pre-commit mandatory**: `npm run build && npm run test:adapter && npm run test:unit-js && npm audit --audit-level=moderate`

**There is no `npm run lint`.** Do not go looking for one. CI's `Lint Code` job is `npm run build` (type check) plus `npm run check:coverage`, `npm run knip`, and `actionlint` (installed by `scripts/install-actionlint.sh`, which fetches the release tarball at a fixed URL and `sha256sum -c`s it against a COMMITTED digest BEFORE extracting; #328 removed the previous `curl | bash` of the upstream installer, which performs no verification of its own and pipes the tarball straight into `tar`. Run as `./actionlint -shellcheck= -color`; the shellcheck integration is disabled deliberately per #180 because its findings vary with the runner's shellcheck version. To bump, change `VERSION` and `SHA256` together, pinned as one set by invariant (q5)). The `Run Tests` job adds `npm run tool-count` and `npm audit` ahead of `test:unit-js`, and `Docker E2E Tests` runs `npm run test:e2e:docker:full`, not the smoke variant. Ignore the "63 tests" in that CI step's name (`ci-cd.yml`, `Run Docker E2E tests (FULL - 63 tests)`) and in the usage text of `tests/e2e/run-docker-e2e.sh`: it is a stale label. `docker-all-tools.e2e.spec.ts` currently collects 94 tests, some of which skip themselves at runtime when a fixture is missing. `npm run tool-count` polices TOOL totals, not test counts, so nothing keeps those two labels honest.

**The `ci-cd.yml` jobs beyond those three**, in file order, are `Version Generation` (feeds the others via `needs: version`), `Node Floor Guard (below-floor interpreter)`, `Validate Docker Description`, the per-platform `Build ${{ matrix.platform }} image` matrix, then the publish and post-publish lane: `Build & Publish Docker Images`, `Publish to npm`, `Verify Published Artifacts` (#326), `Train Liveness` (#327), `Security Scan`, `Update Docker Hub Description`, `Deployment Test`, `Create Release`, and `Pipeline Summary`. **Read the Node Floor Guard's log carefully before calling it a failure.** It deliberately installs Node 20, which is below the `engines` floor, then asserts that both `bin/actual-mcp-server.js` and `dist/src/index.js` exit 1 with a legible "requires Node" message instead of the raw `ERR_IMPORT_ASSERTION_TYPE_MISSING` crash (#275), and that the dist entry writes nothing to stdout so stdio framing stays clean. A passing run therefore prints a below-floor Node version and a rejection message. That output is the assertion succeeding. The job exists because every other job runs on a supported Node, where the guard is a no-op and could rot unnoticed.

**There are six workflows in `.github/workflows/`**, and the doc above only names some of them inline:

| Workflow | Role |
|----------|------|
| `ci-cd.yml` | The main pipeline (the jobs described above) |
| `dependency-update.yml` | `Dependency Update & Auto-Release`: the scheduled `@actual-app/api` release train, plus a `report-train-failure` job |
| `api-surface-drift.yml` | The NON-BLOCKING lane that reports live `@actual-app/api` surface drift. It exists precisely so the unit suite can stay hermetic (#321); do not make it blocking, that is the failure mode it was built to remove |
| `template-lockstep.yml` | Runs `scripts/check-template-lockstep.sh` to keep the four issue templates and `docs/guides/ticket-standards.md` on one `template-version` marker |
| `unraid-xmllint.yml` | Validates `unraid/actual-mcp-server.xml` |
| `copilot-setup-steps.yml` | Environment bootstrap for the GitHub Copilot coding agent; not a gate |

**Do NOT run in ephemeral environments**: `test:e2e`, `test:integration:*`, `dev`/`start` (need real `.env`), `release:*`/`docs:sync` (human responsibility only), `deploy:*` (needs Docker). `test:integration:cleanup` deletes test data created by `full`. Only run it after `full` against a test budget.

**Integration test modules** (`tests/manual/tests/`): `sanity` (read-only protocol), `smoke` (balances/categories), `account`, `category-group`, `category`, `payee`, `transaction`, `budget`, `notes`, `rules`, `schedule`, `batch_uncategorized_rules_upsert`, `entrypoint`, `advanced` (bank sync, raw SQL).

**Shared test infrastructure** lives in `tests/shared/`: `mcp-protocol.js` (JSON-RPC framing helpers used by the manual runner) and `e2e-helpers.ts` (used by the Playwright specs). Beyond the two "all tools" specs, `tests/e2e/` also holds `stdio.spec.ts` (stdio transport protocol) and `docker.e2e.spec.ts`, and the per-domain happy-path calls live in `tests/e2e/suites/*.ts` with cross-suite state in `suites/shared-context.ts`.

## Project-Local Agents & Commands

Five **project-specific** subagents live in `.claude/agents/`. Delegate to them via the Agent tool for complex tasks in their domain:

| Agent | When to use |
|-------|-------------|
| `tool-author` | Adding a new MCP tool end-to-end (file, registration, adapter, tests, docs) |
| `qa` | Writing, reviewing, or debugging tests at any layer (unit, integration, E2E, manual) |
| `release-manager` | Version bumps, docs sync, GitHub issue triage, closing fixed tickets |
| `actual-api` | Questions about `@actual-app/api` behaviour, field names, quirks, `withActualApi` lifecycle |
| `ticket-gate` | Readiness gate for GitHub issues (forge-kit ticket-gate v1). Runs 6 core specialist agents (tool-author, qa, release-manager, actual-api, security-auditor, architect-review) to score a ticket before implementation (all must score 10/10; an agent whose domain the ticket does not touch auto-scores 10 N/A) |

Additional generic agents from forge-kit governance also live alongside them (`architect-review`, `code-reviewer`, `code-simplifier`, `coding-standards-auditor`, `security-auditor`, `backend-security-coder`, `api-security-tester`, `performance-engineer`, `test-automator`, `tdd-orchestrator`, `dep-auditor`, `code-health-auditor`, `health-check`). Use these for cross-cutting reviews; prefer the project-specific agents above whenever the task is in their domain. (`dep-auditor` owns dependency health; `code-health-auditor` (#234) owns source dead code and doc-to-code drift; `api-security-tester` runs read-only security probes against a LOCAL instance only.)

Project-local slash commands in `.claude/commands/`:

- `/implement-ticket <issue-number>`: the end-to-end pipeline for a GitHub issue (gate to 10/10, implement, validate, code review, commit + patch bump + push to `develop`). Stops at `develop` by design.
- `/merge-pr <pr-number>`: never merges a PR directly. Files a gate-ready ticket to reimplement the change on `develop`, runs it through `/implement-ticket`, then closes the PR as superseded.
- `/release`: the ONLY sanctioned path to `main`. Fast-forwards `main` to `develop`, tags, verifies the publish pipeline, and closes the tickets the release ships.

- `/dep-auditor [--full]`: DEPENDENCY health audit. Runs Knip (unused deps), npm registry health, `npm audit`, and version drift checks, then opens GitHub issues for findings (cache-first; `--full` re-audits everything).
- `/code-health-auditor [--full] [--dry-run]`: SOURCE code-health audit (#234). Runs the committed Knip config (dead files/exports/types) plus the doc-to-code drift guards, triages against the documented allowlist, and opens gate-ready tickets for genuine findings (cache-first via `docs/audit/deadcode-audit-cache.json`). Run MANUALLY; no scheduling. Complements `/dep-auditor` (it owns deps, this owns source).
- `/local-env`: full local deployment pipeline for the dev environment.
- `/gate-ticket <issue-number>`: runs the ticket readiness gate on a GitHub issue (all 6 core specialist agents must score 10/10 before implementation; a non-touched domain auto-scores 10 N/A).
- `/ci-health`: checks all GitHub Actions workflows for failures, opens P0 tickets, and auto-fixes safe failures.
- `/full-review [target]`: orchestrates a multi-dimensional code review (architecture, security, performance, testing, best practices).
- `/pr-enhance [PR# or description]`: enhances an existing pull request (description, labels, follow-ups).

Project-local skills in `.claude/skills/` (invoked via the Skill tool, or automatically when their trigger phrases appear):

| Skill | Purpose |
|-------|---------|
| `implement-ticket`, `merge-pr`, `release` | The workflow bodies behind the same-named slash commands above |
| `api-design-principles` | Consistency rules for the 71-tool MCP surface; read before adding or revising a tool schema |
| `owasp-api-security` | Security test patterns for the MCP transport (pairs with the `api-security-tester` agent) |
| `fork-analysis` | Harvests feature ideas from forks/branches into gate-ready tickets; caches results in `docs/audit/FORK_ANALYSIS.md` |
| `release-automation` | Governs the CI release gate (no main promotion without a version bump) and the auto-release lanes |
| `working-overnight` | Governed unattended work: branch plus PR only, never merges, writes a morning report |

### Registered hooks

All four live in `.claude/hooks/` and are registered in `.claude/settings.local.json`. Two are described in detail elsewhere in this file; the other two are easy to be surprised by:

| Hook | Event | Notes |
|------|-------|-------|
| `block-dashes.py` | `PreToolUse` on `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash` | Enforces the no-dashes output convention above |
| `require_green_develop_before_main.py` | `PreToolUse` on `Bash` | Blocks any merge, push, or release tag aimed at `main`; fails closed |
| `overnight-guard.py` | `PreToolUse` on `Bash` | **Inert unless `.claude/overnight/active.md` exists.** Its shell wrapper exits 0 immediately when that file is absent, so it costs nothing in a normal session and only constrains commands during a `working-overnight` run |
| `overnight-continue.py` | `Stop` | Fires when a turn ENDS, and can continue the session rather than letting it stop. If a session appears to keep going on its own, this is why. Belongs to the same overnight lane |

## Issue Labels

Every issue carries at least one **area** label (`backend`, `infrastructure`, `security`, `actual-api`, `documentation`; the gate enforces this) and one **priority** label: `P0` (Critical), `P1` (High), `P2` (Medium), `P3` (Low). Speculative, not-yet-committed ideas also get `icebox`. Apply the priority label on triage so the backlog is filterable: `gh issue list --label P1`. The feature and infrastructure issue templates have a Priority dropdown whose selection should be mirrored to the matching label.

**Canonical ready-ticket standard: `docs/guides/ticket-standards.md`.** That doc is the single source of truth for what a ready work ticket must contain; the four work issue templates (`bug`, `feature_request`, `infrastructure`, `security`) collect it, the `ticket-gate` agent scores against it, and `scripts/check-template-lockstep.sh` (CI: `.github/workflows/template-lockstep.yml`) keeps the templates and that doc on one shared `<!-- template-version: N -->` marker so they cannot silently drift.

## Architecture

### Layered Design

```
AI Client (LibreChat/LobeChat)       Claude Desktop / Claude Code
    ↓ HTTP/MCP JSON-RPC                   ↓ stdin/stdout JSON-RPC
Express + StreamableHTTP             StdioServerTransport
(src/server/httpServer.ts)           (src/server/stdioServer.ts)
    ↓                                     ↓
ActualMCPConnection (src/lib/ActualMCPConnection.ts)
    ↓
ActualToolsManager (74 tools, Zod validation, dispatch) at src/actualToolsManager.ts
    ↓
actual-adapter.ts (withActualApi wrapper, retry 3x, concurrency limit 5)
    ↓
@actual-app/api v26 → Actual Budget Server
```

**Transport is selected via CLI flag** (`--http` or `--stdio`); they are mutually exclusive. The `--stdio` flag sets `MCP_STDIO_MODE=true` **before** importing the logger so that all log output is routed to stderr (stdout is reserved for JSON-RPC framing).

### Critical Pattern: `withActualApi` Wrapper

**Every Actual API operation MUST use `withActualApi()`** from `src/lib/actual-adapter.ts`. Two execution modes since #134 (v0.6.4):

- **Pooled mode (preferred, fires automatically when an MCP session is active):** if `requestContext` carries a `sessionId` AND `connectionPool.hasConnection(sessionId)` is true AND `apiState.isApiInitialized()` is true, the wrapper skips `api.init()` / `api.shutdown()` entirely and runs the operation against the existing per-session connection. This eliminates the per-op upstream-login burst that was the root cause of #127. Writes still call `api.sync()` afterward to commit.
- **Legacy mode (fallback):** when there's no sessionId in context, no pool entry, or the api singleton was torn down by another path, the wrapper falls back to the original `init` → `op` → `shutdown` cycle so non-MCP callers (CLI scripts, startup health checks, stdio without `requestContext.run`) keep working.

```typescript
// ✅ CORRECT
await withActualApi(async () => { return await rawAddTransactions(data); });

// ❌ WRONG: data won't persist (tombstone issue) and bypasses pool cooperation
await rawAddTransactions(data);
```

**Never nest one session inside another: it deadlocks.** Both modes run the operation inside `withApiLock`, a strict FIFO chained-promise mutex that is NOT reentrant (`_apiSessionLock` in `actual-adapter.ts`). An inner session takes the outer call's own release promise as the lock it waits on, and that release cannot fire until the outer callback resolves, so the inner call never settles on its own. **What you actually observe is a ~30s stall followed by `Actual API operation timed out after 30000ms (ACTUAL_OP_TIMEOUT_MS)`**, because #270 wraps each operation body in `withOpTimeout` INSIDE the lock, and that race is what breaks the deadlock. Read that timeout as a probable nesting bug, not as a slow upstream server. One caveat: setting `ACTUAL_OP_TIMEOUT_MS` to exactly `0` makes `withOpTimeout` a pass-through (`opTimeout.ts`), which restores the hangs-forever behaviour. The Zod transform in `config.ts` sanitises most bad input first: a negative value or one with no leading digit falls back to 30000, 1 to 249 is clamped up to 250, and anything above 2147483647 is clamped DOWN to it, because a larger delay overflows `setTimeout` and silently becomes 1ms, which would time out every operation. It is `parseInt`-based though, so it truncates rather than rejects: `0.5` becomes `0` and disables the bound, while `30s` becomes 250 rather than 30000. If you are chasing a hang, read the configured value as `parseInt` sees it. Note also that the protection is per-call-site rather than structural: every `withApiLock` body currently wraps its operation in `withOpTimeout`, but nothing enforces that, so a future acquisition site added without one would deadlock silently (compare #278's lost wakeup, where the absence of an error was the only tell).

So a tool must never wrap an `adapter.*` call in a session of its own, and code already inside a session callback must reach the API through the raw functions, not back through `adapter.*`. Exactly five tool files therefore statically import `@actual-app/api`, for two different sanctioned reasons:

- `rules_delete.ts`, `rules_create_or_update.ts`, `schedules_delete.ts`, `category_groups_delete.ts`: `raw*` calls inside one `adapter.withWriteSession(...)`. This is the sanctioned way to combine a read and a write in a single cycle (#142).
- `budget_updates_batch.ts`: `raw*` calls inside `adapter.batchBudgetUpdates(...)`. Not a read plus write; it is a batch of pure writes, and it predates #142 as the original fix for exactly the nesting hazard above. Its in-code comment says so ("Use raw API calls directly to avoid nested queueing/deadlock").

`transactions_summary_by_payee.ts` and `transactions_summary_by_category.ts` are NOT this pattern and will not show up in a `from '@actual-app/api'` grep: they `await import('@actual-app/api')` inside the handler purely to get the `q()` ActualQL query builder, then hand the built query to `adapter.runQuery()`, which opens the one session.

The pool branch only releases its session connection on **infrastructure-level errors**. Since #177, `_shouldDropPoolOnError` in `actual-adapter.ts` has been a one-line delegation to `isRetryableError` in `src/lib/retry.ts`, so the retry decision and the pool-drop decision share ONE source of truth (`TRANSIENT_ERROR_PATTERNS`) and cannot drift apart. Do not reintroduce a second list. The patterns are `Authentication failed`, `ECONNRESET`, `ECONNREFUSED`, `socket hang up`, `ETIMEDOUT`, `out of memory`, `ENOMEM`, and `timed out`. That last one is #270's own timeout message: classing it transient drops the pooled connection so the next call re-inits cleanly, and it causes no retry storm because `withOpTimeout` rejects OUTSIDE any `retry()`. Anything not matching (Zod failures, "field does not exist", "not found", and every unknown error) is terminal: it is never retried, and it leaves the pool entry intact so the next call can reuse it.

### Tool Structure Pattern

New tools should use `createTool()` from `src/lib/toolFactory.ts`. It wires up error handling, logging, and observability automatically:

```typescript
import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_domain_action',      // naming: actual_{domain}_{action}
  description: '...',
  schema: z.object({
    account: CommonSchemas.accountId,
    amount: CommonSchemas.amountCents, // always in cents, integer
    date: CommonSchemas.date,          // YYYY-MM-DD
  }),
  handler: async (input) => {
    return await adapter.someMethod(input);
  },
  examples: [                          // optional but recommended
    { description: 'Example use case', input: { account: 'uuid', amount: 5000, date: '2024-01-15' } },
  ],
});
```

Many existing tools still use the older pattern. Both work, but `createTool()` is preferred for new tools:

```typescript
// Legacy pattern (most existing tools)
import type { ToolDefinition } from '../../types/tool.d.js';
const InputSchema = z.object({ ... });
const tool: ToolDefinition = {
  name: 'actual_domain_action',
  description: '...',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    return await adapter.someMethod(input);
  },
};
export default tool;
```

### Adding a New Tool

1. Create `src/tools/new_tool.ts` using the pattern above
2. Export it from `src/tools/index.ts` (e.g. `export { default as new_tool } from './new_tool.js';`). Despite the "Auto-generated index" header on that file, exports are added manually; no script regenerates it.
3. Add tool name to `IMPLEMENTED_TOOLS` array in `src/actualToolsManager.ts`
4. Add unit tests in `tests/unit/` (positive + negative cases)
5. Run `npm run verify-tools` to confirm registration
6. Bump the `EXPECTED_TOOL_COUNT` default in `tests/manual/tests/sanity.js`, which is the ONLY place that asserts an exact tool count, then run `npm run tool-count -- --fix` for the prose totals. Neither e2e spec carries an `EXPECTED_TOOL_COUNT`: `mcp-client.playwright.spec.ts` only asserts `tools.length > 0`, and the number in `docker-all-tools.e2e.spec.ts` is a cosmetic `describe(...)` label plus a header comment. Add a happy-path call to `tests/e2e/suites/<domain>.ts`
7. See `docs/NEW_TOOL_CHECKLIST.md` for the full 9-step checklist (includes doc sync, integration test entry, manual-prompt update)

### Key Source Files

| File | Role |
|------|------|
| `bin/actual-mcp-server.js` | The npm `bin` entry (`package.json` `bin.actual-mcp-server`). Distinct from `dist/src/index.js`, which `npm start` uses: the Node Floor Guard CI job asserts BOTH reject a below-floor interpreter |
| `src/index.ts` | Entry point, CLI flags, server startup |
| `src/actualToolsManager.ts` | `IMPLEMENTED_TOOLS` registry, Zod dispatch |
| `src/lib/ActualMCPConnection.ts` | The per-connection MCP server object both transports wrap (see the layered diagram above); registers tools, prompts, and resources |
| `src/lib/actual-adapter.ts` | **CRITICAL**: `withActualApi` (pool-cooperation since #134), `withActualApiWrite`, retry, plus every `adapter.*` method the tools call |
| `src/lib/actual-adapter/` | Modules split out of `actual-adapter.ts` in #166 and re-exported from it (importers and the public surface are unchanged): `concurrency.ts` (the limiter, and the ONLY owner of `MAX_CONCURRENCY`/running/queue state), `auth-retry.ts` (`withAuthRetry` around `api.init()`, and the ONLY owner of the two auth-retry counters), `normalize.ts` (pure coercion of the varied raw `@actual-app/api` response shapes), `query.ts` (`parseWhereClause`, the SQL-to-ActualQL WHERE translation behind `actual_query_run`). Mutable state deliberately never crosses a module boundary: `actual-adapter.ts` reads the counters through `getAuthRetryCounts()` for `getConcurrencyState()` |
| `src/lib/opTimeout.ts` | #270: bounds a single upstream call (`api.init`, `downloadBudget`, `api.sync`, each tool op) so a stall cannot hold the process-global API mutex forever |
| `src/lib/authPosture.ts` | #242: decides ONCE at startup whether the HTTP auth posture is safe, making authentication required-by-default so a blank token cannot silently publish the server on the LAN |
| `src/lib/ActualConnectionPool.ts` | Up to 15 concurrent sessions, idle timeouts; updates the singleton-state flag in `apiState.ts`. Both limits in the diagram above are env-overridable defaults, not constants: `MAX_CONCURRENT_SESSIONS` (15) here, `ACTUAL_API_CONCURRENCY` (5) in `actual-adapter/concurrency.ts` |
| `src/lib/apiState.ts` | Shared module-level flag for `@actual-app/api`'s singleton "live" state. Updated by every `init`/`shutdown` path so the adapter can probe whether the pool branch is safe |
| `src/lib/requestContext.ts` | `AsyncLocalStorage<{ sessionId? }>` carrying the active MCP session across async boundaries. Producer: `httpServer.ts`. Consumer: `actual-adapter.ts` (decides pool reuse) |
| `src/server/httpServer.ts` | Express HTTP, StreamableHTTP, Bearer/OIDC auth |
| `src/server/stdioServer.ts` | stdio transport. Logs to stderr, stdout reserved for JSON-RPC |
| `src/auth/setup.ts` | OIDC/JWKS factory (`AUTH_PROVIDER=oidc`) |
| `src/auth/budget-acl.ts` | Per-user budget ACL (email/sub/group principals) |
| `src/lib/oidc-discovery.ts` | #244: resolves the real `jwks_uri` from the IdP discovery document instead of assuming `${OIDC_ISSUER}/.well-known/jwks` |
| `src/lib/oidc-audiences.ts` | #245: builds the closed set of accepted `aud` values (`OIDC_RESOURCE` plus `OIDC_ACCEPTED_AUDIENCES`) |
| `src/lib/budget-preference-store.ts` | #189: remembers a principal's last active budget so a post-restart session restores it instead of silently reverting to the env default |
| `src/config.ts` | Zod environment validation. All config lives here |
| `src/lib/config-registry.ts` | `RAW_ENV_ALLOWLIST`: the second half of the canonical config surface, for vars read straight off `process.env` instead of through the Zod schema. `scripts/config-drift.mjs` diffs schema plus allowlist against `.env.example` and the README env table |
| `src/lib/schemas/common.ts` | Shared Zod schemas (`CommonSchemas`) |
| `src/lib/schemas/recur.ts` | Recurrence-rule schemas for the `schedules_*` tools |
| `src/lib/constants.ts` | `UUID_PATTERN`, timeouts, limits. Owns `DEFAULT_RETRY_ATTEMPTS` (3), `DEFAULT_RETRY_BACKOFF_MS` (200), `MAX_RETRY_DELAY_MS` (10000), `DEFAULT_CONCURRENCY_LIMIT` (5) |
| `src/lib/retry.ts` | Exponential backoff (3 attempts, 200ms base, capped at 10s per delay) AND `TRANSIENT_ERROR_PATTERNS` / `isRetryableError`, the single source of truth for both the retry and the pool-drop decision (#177) |
| `src/lib/loggerFactory.ts` | Module-scoped winston loggers |
| `src/lib/toolFactory.ts` | `createTool()`, the preferred factory for new tools |
| `src/actualConnection.ts` | Actual Budget connection lifecycle |
| `src/lib/errors.ts` | `notFoundMsg()`, `constraintErrorMsg()` helpers |
| `src/observability.ts` | Per-tool call counters (incremented by `createTool`). `prom-client` is an OPTIONAL dependency (`"*"` in `optionalDependencies`), dynamically imported and adapted to at runtime; when it is absent every counter silently no-ops. So missing metrics is a normal install state, not a bug |
| `src/lib/budget-registry.ts` | Parses `BUDGET_N_*` env vars into budget config list |
| `src/prompts/` | MCP prompt definitions (e.g. `showLargeTransactions`) |
| `src/resources/` | MCP resource definitions (e.g. `accountsSummary`) |
| `src/lib/actual-schema.ts` | Actual Budget DB schema (tables/fields/join paths); source of truth for SQL validation |
| `src/lib/query-validator.ts` | Pre-validates SQL queries against `actual-schema` before execution to prevent server crashes |
| `src/lib/zod-error-format.ts` | #206: turns a ZodError into one consistent actionable string, applied centrally in `actualToolsManager.callTool` so every tool shares the shape |
| `src/lib/node-version-guard.ts` | #275: fails fast and legibly below the Node engines floor, before the dist module graph loads (npm does not enforce `engines`) |
| `src/lib/server-version-guard.ts` | #276: advisory warning (once) when the Actual Budget SERVER version is outside the range this build's `@actual-app/api` is known to work with |
| `src/lib/rejection-allowlist.ts` | Predicate behind the `unhandledRejection` allow-list in `src/index.ts` (log and keep serving), extracted so it is unit-testable without the entrypoint |

## Key Conventions & Gotchas

**Logging (structured, since #219)**: use `createModuleLogger('MODULE')` from `src/lib/loggerFactory.js`; never call `console.*` directly in source (the console is hijacked to winston for stdio framing safety). Pass structured context as the metadata object (`log.info('did x', { sessionId, count })`), not interpolated into the message, so it is queryable. Levels: `error` (a failure needing attention), `warn` (recoverable/suspicious), `info` (normal lifecycle), `debug` (developer internals). Output format is resolved in `src/logger.ts` straight from `process.env` (it loads before `config.ts`): `LOG_FORMAT=json|pretty`, precedence explicit `LOG_FORMAT` > `NODE_ENV=production` (json) > pretty. JSON records carry `{ timestamp, level, service, module, message, stack?, sessionId?, requestId?, context }`. The `sessionId`/`requestId` correlation fields (#221) are stamped automatically from `requestContext` on every line within an HTTP request (an inbound `X-Correlation-ID` header is honored, else a UUID is generated); they are reserved top-level fields, so do not pass `sessionId`/`requestId` as your own metadata (the request value wins). The format helpers `resolveLogConfig` / `buildLogFormat` are exported and unit-tested in `tests/unit/logger_structured.test.js`. Secrets are redacted centrally (#220): a `redactSecrets` winston format (in `buildLogFormat`, after `splat()`) masks sensitive metadata at any depth, plus the actual configured secret values (`MCP_SSE_AUTHORIZATION`, `ACTUAL_PASSWORD`, `*_PASSWORD`, `*_SECRET`), to `[REDACTED]`. The matcher is `isSensitiveKey` in `src/logger.ts` and has two parts: an exact-name `SENSITIVE_KEYS` set (`authorization`, `proxy-authorization`, `token`, `password`, `encryptionpassword`, `cookie`, `set-cookie`, `secret`, `apikey`, `api_key`, `x-api-key`, `access_token`, `refresh_token`, `client_secret`), and a pattern fallback for any lowercased key ENDING in `password`, `secret`, or `token`, or CONTAINING `authorization` or `cookie`. Still avoid logging secrets deliberately, but the central format is the backstop. To protect a new sensitive field, name it with one of those three suffixes or add it to `SENSITIVE_KEYS`.

**Unit tests must be hermetic about the `@actual-app/api` surface (#321).** No file under `tests/unit/` may enumerate the LIVE `@actual-app/api` module's exported keys (the `Object.keys(<the imported module>)` shape) to build a coverage or gap assertion. Such a test's result changes with no commit: `check_coverage.test.js` asserted the genuine-gaps bucket was empty against the live surface, 26.8.0 added `exportBudget`, `getPreferences` and `importBudget`, and the auto-release train died for two nights while security PR #319 stayed blocked behind the same red test. Use the `FROZEN_API_SURFACE` fixture in `check_coverage.test.js` instead, which is updated only by a deliberate human commit and is never regenerated from `node_modules`.

The rule is scoped to ENUMERATION, deliberately. Importing the package to monkeypatch it for mocking is correct and is what 20 existing unit tests do; do not read this as a ban on the import. Enforced by `tests/unit/unit_chain_membership.test.js`, which also guards that every `tests/unit/*.test.js` appears in the hand-maintained `test:unit-js` chain (there is no glob, so an unlisted file silently never runs, and two were already orphaned that way). Live-surface drift is reported by the separate `api-surface-drift` lane, which is non-blocking by construction.

**The release train has six pre-flight controls (#324)**, in `scripts/train-preflight.mjs`, evaluated in a pinned order: validity, equality, prerelease, direction, denylist, soak. Order is load bearing and unit-tested. Notes that are easy to get wrong: `sort -V` is NOT a semver comparator (it ranks `26.8.0-alpha.1` ABOVE `26.8.0`), and an empty `LATEST` makes a sort-based direction check report a quiet "refusing to downgrade" rather than failing, which is why validity runs first and is the only control whose disposition is a RED run. `.github/actual-api-denylist.txt` makes a rollback stick, and **only its copy on `main` has any effect** because the train checks out `ref: main`. The soak window defaults to 48h and is clamped at BOTH ends (`SOAK_FLOOR_HOURS = 48`, `SOAK_CEILING_HOURS = 168`), because clamping only the floor left the one direction that disables the train silently: a fat-fingered `4800` instead of `48` makes every run report `soaking`, which maps to `ignore`, so the train is off for six months and nobody is told. It also fails closed when the publish timestamp cannot be read. An upstream MAJOR bumps us a MINOR, not a patch: semver describes our 71-tool contract, not our dependency versions. Caveat: `@actual-app/api` majors are CalVer and roll over every January regardless of content, so this fires annually by construction. Rollback runbook: `docs/guides/DEPLOYMENT.md`.

**The rest of the train chain.** Each script solves a distinct "the train died and nobody noticed" failure, and note that they are split across TWO workflows: the two reporting/verification controls deliberately live in `ci-cd.yml`, which runs on every push, because a control that only runs inside the scheduled train cannot report that the scheduled train never ran.

| Script | Ticket | Runs in | What it catches |
|--------|--------|---------|-----------------|
| `scripts/stdio-framing-check.mjs` | #323 | `dependency-update.yml` | **Blocking gate.** Asserts every byte the server writes to stdout under `--stdio` parses as newline-delimited JSON-RPC. Note WHY it is byte-level rather than a functional suite: `src/logger.ts` already hijacks `console.*`, so an upstream `console.log` is a non-issue (26.7.0 already had 14 of them and stdio survives). The genuinely uncovered mode is a raw `process.stdout.write` from the dependency, which the hijack does NOT intercept and which nothing in `src/` patches. It also fits the train's step budget, where a full dual-transport run would not |
| `scripts/report-train-failure.mjs` | #325 | `dependency-update.yml` (job `report-train-failure`) | A failed run used to produce only a red entry in the Actions tab. Opens or updates one GitHub issue, and closes it when a later run succeeds. Fed by the CLOSED `train_outcome` enum |
| `scripts/verify-published-artifacts.mjs` | #326 | `ci-cd.yml` (job `Verify Published Artifacts`) | A green pipeline proves the publish JOBS exited 0, not that a third-party registry now serves the artifact. Separates "the run triggered", "the run went green", and "the artifact exists" |
| `scripts/report-train-stale.mjs` | #327 | `ci-cd.yml` (job `Train Liveness`) | A train that never RAN, which #325 cannot see. GitHub disables scheduled workflows in public repos after 60 days of inactivity, and cron dispatches are dropped under load. Runs with `issues: write` and deliberately does NO `npm ci`, so it never executes a third-party install script while holding that permission |

#322 closed the CI-to-train gate parity gap without introducing a reusable workflow. Each script has a unit test in the `test:unit-js` chain (`stdio_framing_check`, `verify_published_artifacts`, `report_train_failure`, `report_train_stale`, `train_preflight`).

**Amounts are always in integer cents**: `5000 = $50.00`, `-5000 = -$50.00`. Never use decimal dollars.

**`MCP_SSE_AUTHORIZATION` must be the raw token only**, not `"Bearer token123"`. The server extracts the token from the `Authorization: Bearer <token>` header and compares directly.

**`MCP_ENABLE_HTTPS=true`** enables native TLS. Set `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY` to PEM file paths. A reverse proxy is still preferred for production (certificate rotation, SNI), but native TLS works for simple single-host deployments.

**Date fields require `YYYY-MM-DD` strings**. Never use `Date.now()` (it produces a number).

**Multi-budget mode**: `BUDGET_N_NAME`, `BUDGET_N_SYNC_ID`, `BUDGET_N_SERVER_URL`, `BUDGET_N_PASSWORD`, `BUDGET_N_ENCRYPTION_PASSWORD` (N = 1, 2, 3…). Server URL and password fall back to the default `ACTUAL_*` vars if omitted.

**`mcp-remote` requires `--allow-http`** for HTTP connections, because it enforces HTTPS by default. Without the flag, clients see `URL must use HTTPS`. Some versions of Claude Desktop also enforce HTTPS at the app level; in that case, switch to native TLS (`MCP_ENABLE_HTTPS=true`).

**Documentation hygiene**: Prefer deletion over archiving. When a feature ships, delete its `docs/feature/*.md` spec. Planned and future work is tracked as GitHub issues, not a roadmap file. Never move to `archive/` folders; git history is the archive.

**Version/tool count markers** (`**Version:**`, `**Tool Count:**`) across all docs are managed automatically by `scripts/version-bump.js` on `release:*` / `docs:sync`. Never edit them manually.

**Production-tag freshness check (added in v0.6.5):** before any bump, `scripts/version-bump.js` queries `git ls-remote --tags origin` and aborts if the local `VERSION` is BEHIND the latest published `vX.Y.Z` tag. This guards against the parallel-bump pattern that occurred when the scheduled `Dependency Update & Auto-Release` workflow shipped a release while a local branch was unsynced. If you see the abort message, run `git fetch origin && git merge origin/main` before retrying. Override only with `--force`, and only when production is genuinely wrong; the `release-manager` agent requires explicit user confirmation before invoking that flag.

**`npm overrides` are a last resort for security CVEs only.** Prefer upgrading the direct dependency that pulls in the vulnerable transitive. If an override is unavoidable (no direct-dep upgrade available), add it with an explanation in `package.json`'s `"comments"."security-overrides"` field (see existing `ajv`/`qs` entries as the pattern). Never use overrides to resolve non-security version drift.

**Session tools are the only exception to `withActualApi`**: `actual_session_list` and `actual_session_close` call `connectionPool` directly. They manage the pool itself, not budget data, so they skip the wrapper intentionally.

**If transactions/budgets don't persist**: verify `withActualApi` wraps the call (grep for `rawAdd*` / `rawUpdate*` called without it), confirm `api.shutdown()` runs after the operation (or that `api.sync()` ran in pool mode), and check logs for "tombstone" errors. The `getConcurrencyState()` export from `actual-adapter.ts` shows `{ running, queueLength, maxConcurrency, authRetries, authRetryFailures, connectionReuses }` for diagnosing concurrency back-pressure and pool-reuse health. A growing `connectionReuses` counter without growing `authRetries` is the healthy signal that #134's cooperation is working.

**Integration test runner kill-switches (added in v0.6.4 via #133):** `tests/manual/index.js` (used by `/local-env` and `npm run test:integration:*`) now caps every retry path so a crash-looping MCP server can't livelock the runner. Defaults can be overridden via env vars when you need to relax them in a slow environment or tighten them in CI:

| Env var | Default | What it caps |
|---------|---------|--------------|
| `MCP_TEST_MAX_RETRIES` | 5 | Connection-lost / timeout retries per `callMCP` invocation |
| `MCP_TEST_MAX_SESSION_RETRIES` | 3 | Session-expired re-initialisations per logical chain (closure-state, survives recursion) |
| `MCP_TEST_CIRCUIT_THRESHOLD` | 10 | Consecutive failed `callMCP` invocations before the circuit breaker opens |
| `MCP_TEST_MAX_RUNTIME_MS` | per-level (sanity 60s, smoke 120s, normal 300s, extended 600s, full 900s) | Wall-clock budget in `runner.js`; exceeding it exits **code 2** (distinct from code 1 used for assertion failures) with `Aborted after N min, server appears unhealthy` |
| `MCP_TEST_TRANSPORT` | `http` | Which transport the suite runs over: `http` or `stdio` (#280) |
| `MCP_TEST_BUDGET_SYNC_ID` | unset | Designates a budget as DISPOSABLE. The pre-run residue sweep deletes nothing unless this matches the budget the server has loaded. Unset = sweep skipped (#280) |
| `MCP_TEST_SWEEP_MAX` | 50 | Abort the sweep rather than delete more than this many objects (wrong-budget signal) (#280) |

## File Safety Tiers

**Safe to modify**: `src/tools/*.ts`, `tests/**`, `docs/**/*.md`, `README.md`, `.env.example`, `docker-compose.yaml`, `examples/mcp-clients/**` (6 client config examples; update when transport/auth changes)

**Modify with caution** (test thoroughly): `src/lib/actual-adapter.ts` (affects all tools), `src/actualToolsManager.ts` (run `verify-tools` after), `src/server/*.ts` (verify with MCP client), `src/index.ts`, `src/actualConnection.ts`

**Do not modify without explicit permission**: `types/*.d.ts`, `generated/**/*` (auto-generated), `scripts/version-bump.js`, `VERSION`

## Documentation Sync

When changing code, update these docs:

| Change | Required updates |
|--------|-----------------|
| New tool | `README.md` (count + table), `docs/ARCHITECTURE.md` tool list, `tests/e2e/docker-all-tools.e2e.spec.ts` (describe block name) |
| New env var | `.env.example`, `docs/ARCHITECTURE.md` config section, `README.md` env table |
| Auth/security change | `docs/SECURITY_AND_PRIVACY.md`, `docs/guides/AI_CLIENT_SETUP.md` |
| Docker change | `docs/ARCHITECTURE.md`, `README.md`, `docs/guides/DEPLOYMENT.md` |
| New feature shipped | `README.md` if user-facing, delete its `docs/feature/*.md` spec |
| New tool added | `tests/manual-prompt/prompt-{1\|2\|3}-*.txt` (add positive + negative scenario, update phase count); `tests/manual-prompt/README.md` Phase Overview total; run `npm run docs:sync` (updates `docker/description/long.md`, `docker/description/short.md`, and all `**Tool Count:**` markers) |
| Test module added | `docs/TESTING_AND_RELIABILITY.md` (test-file table) |
| New tool/prompt/resource/script | run `npm run knip` (a new unused export/file is reported) and `node tests/unit/advertised_tools_sync.test.js` (a tool advertised in README must be in `IMPLEMENTED_TOOLS`); for a brand-new entry-point category, add it to `knip.json` `entry` |

## Documentation Map

- `docs/ARCHITECTURE.md`: component layers, data flow, transport protocols
- `docs/CONFIGURATION.md`: canonical inventory of every config variable (type, default, source, read site). A var is canonical if it is a Zod schema key in `src/config.ts` OR an entry in `RAW_ENV_ALLOWLIST` in `src/lib/config-registry.ts`. The drift guard `scripts/config-drift.mjs` (run in CI via `tests/unit/config_drift.test.js`) fails the build when the schema/allowlist, `.env.example`, and the README env table disagree. Run `npm run config-drift` after touching any config var.
- `docs/NEW_TOOL_CHECKLIST.md`: canonical 9-step guide for adding tools
- `docs/TESTING_AND_RELIABILITY.md`: test-file inventory, integration test module table
- `docs/guides/AI_CLIENT_SETUP.md`: LibreChat/LobeChat setup, Docker networking, TLS, OIDC/ACL
- `docs/guides/MCP_CLIENTS_SETUP.md`: per-client setup recipes (Claude Desktop, Cursor, etc.); complements AI_CLIENT_SETUP.md
- `docs/audit/api-coverage-baseline.json`: accepted uncovered `@actual-app/api` methods (#321). Human-maintained by deliberate commit; the drift lane never writes it. Suppresses REDNESS only, never re-filing (that is the tracker sentinel's job). Guarded by `tests/unit/api_coverage_baseline.test.js`
- `docs/audit/dep-audit-cache.json`: cache used by `/dep-auditor` to skip recently-checked libraries; do not edit manually
- `docs/audit/deadcode-audit-cache.json`: cache used by `/code-health-auditor` (#234) to avoid re-filing dead-code findings (keyed `kind:path:symbol`); the skill maintains it. The committed `knip.json` is the dead-code config (blocking in CI since #237: `knip` exits nonzero on dead code); `tests/unit/knip_config.test.js` guards its entry points and that `scripts.knip` stays failing-mode (no `--no-exit-code`), and `tests/unit/advertised_tools_sync.test.js` guards that README-advertised tool names exist in `IMPLEMENTED_TOOLS`.
- `docs/audit/FORK_ANALYSIS.md`: fork-feature analysis maintained by the `fork-analysis` skill (one row per analysed fork branch, both a cache so unchanged branches are skipped next run and a source of implementation ideas). Lives alongside the other skill-maintained audit artifacts; `scripts/tool-count.mjs` scans it for tool-count drift.
- `docs/guides/DEPLOYMENT.md`: Docker Compose profiles, Kubernetes, upgrade steps
- `scripts/README.md`: what every script in `scripts/` is for. Most are reachable through an npm script, but a few are direct-invoke diagnostics with no npm wrapper: `stdio-smoke.mjs` (drives the stdio transport end to end via `docker exec` inside the already-healthy bearer container, so no secrets touch the host; override the container with `MCP_STDIO_CONTAINER`), `regression-270-stall.mjs` and `diag-270-http.mjs` (the #270 operation-timeout stall), `import-test-budget.sh`, and `bootstrap-and-init.sh`
- `docs/SECURITY_AND_PRIVACY.md`: auth models, threat model
- `tests/manual-prompt/`: three prompt files for LLM-driven end-to-end verification (paste sequentially into an AI chat); update when adding tools
- `docker/description/long.md`, `docker/description/short.md`: Docker Hub descriptions; managed by `npm run docs:sync`
- `.env.example`: all environment variables with inline documentation
- `.github/instructions/*.instructions.md`: four PATH-SCOPED convention files (Copilot format, but the rules are the project's own). Each has an `applyTo` glob: `src/tools/*.ts` (tool naming, file name must match the tool name, `CommonSchemas` usage, parse-before-logic, and the reminder that `verify-tools` reads `dist/` so you must build first), `tests/unit/*.{js,ts}`, `tests/e2e/*.spec.ts`, `tests/manual/tests/*.js`. Worth reading before editing a file under that glob, but **THIS file wins on conflict**, and each of those files now says so explicitly. `tool-files.instructions.md` used to carry a blanket "never import `@actual-app/api` directly", which was never true: `budget_updates_batch.ts` had imported it since January 2026, two months before that file was written, and the four `withWriteSession` tools joined later under #142. It has been corrected to the five-file rule above. Its companion rule, "do NOT add a second wrapper", was always right and is now stated with the deadlock as its reason. `.github/copilot-instructions.md` is the repo-wide sibling and overlaps heavily with this file, so it drifts the same way
- `unraid/actual-mcp-server.xml` + `docs/UNRAID_CA_PUBLISHING.md`: the Unraid Community Applications template and its publishing guide. `tests/unit/unraid_template_alignment.test.js` pins the template's port against `MCP_BRIDGE_PORT` in `src/config.ts`, its `Data` mount against `ENV MCP_BRIDGE_DATA_DIR` in the `Dockerfile`, the `<Repository>` literal, `Mask="true"` on the three secret fields, `Required="true"` on `MCP_SSE_AUTHORIZATION`, and that the `<Description>` still warns a blank token disables HTTP auth (six positive checks plus a negative one); `.github/workflows/unraid-xmllint.yml` validates the XML. Note what is NOT guarded: the template's env-var SET is not diffed against `src/config.ts` or `RAW_ENV_ALLOWLIST`, so adding or renaming an env var will pass CI while leaving the template stale. Mirror it by hand
