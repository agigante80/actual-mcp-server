# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Actual MCP Server** bridges AI assistants with [Actual Budget](https://actualbudget.org/) via the Model Context Protocol (MCP), exposing **71 tools** for conversational financial management. Supports two transports: **HTTP** (for LibreChat/LobeChat/multi-user deployments) and **stdio** (for Claude Desktop/Claude Code local use; pass the `--stdio` flag).

**Tech Stack**: TypeScript (NodeNext/ESM), Node.js 20+, `@actual-app/api` v26, `@modelcontextprotocol/sdk`, Express 5, Zod v4, Playwright

## Output Convention: never use em or en dashes

**Hard project rule. Applies to ALL output: chat, commits, GitHub comments and PR/issue bodies, file content, code comments, release notes.** Never write the unicode em dash character (U+2014) or en dash character (U+2013).

When you would have written one, restructure the sentence so no dash is needed at all. Do NOT substitute with a regular ASCII hyphen (the hyphen is reserved for genuine compound words like `post-merge`, `cherry-pick`, `off-budget`).

Replacement patterns:
- Introducing an explanation or list: use a colon. "Result: it shipped."
- Parenthetical aside: use commas or parentheses. "The fix, cherry-picked, landed cleanly." Or "The fix (cherry-picked) landed cleanly."
- Range: use the word "to" or "through". "v0.6.4 to v0.6.6", "Monday through Friday".
- Strong pause or contrast: split into two sentences.

Mechanical enforcement: a PreToolUse hook at `.claude/hooks/no_dashes_hook.py` (registered in `.claude/settings.local.json`) blocks any `Edit`, `MultiEdit`, `Write`, or `Bash` tool call whose payload contains an em or en dash, and tells the model how to restructure. The hook script's output is shown back to the model verbatim. Self-check before submitting tool calls regardless of whether the hook is currently armed.

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
npm run dev -- --http --debug   # Dev mode with HTTP transport + debug logs
npm run dev -- --stdio --debug  # Dev mode with stdio transport (for Claude Desktop/Code)
npm run start                   # Production HTTP (requires build first)
node dist/src/index.js --stdio  # Production stdio

# Testing (validation sequence, run in this order)
npm run build                   # Step 1: must compile cleanly
npm run verify-tools            # Step 2: all 71 tools registered (reads dist/)
npm run test:unit-js            # Step 3: unit + schema tests
npm audit --audit-level=moderate # Step 4: no new vulnerabilities

# Individual test commands
npm run test:adapter            # Adapter: retry, concurrency, init/shutdown
node tests/unit/transactions_create.test.js   # Single unit test file
npx playwright test --grep "initialize -> tools/list"  # Single E2E test
npm run test:e2e                # Full Playwright E2E (requires no live server)
npm run test:integration:smoke  # Live server integration (levels: sanity < smoke < normal < extended < full < cleanup)
npm run test:all                # Convenience: adapter + unit + docker:smoke (no live server needed)

# Tools
npm run verify-tools            # Verify tool count + registration
npm run check:coverage          # List @actual-app/api methods vs tool coverage
npm run test:mcp-client         # Connect as MCP client and exercise tools

# Manual connection tests (requires .env)
npm run dev -- --test-actual-connection  # Test Actual Budget connection only

# Docker
docker compose --profile dev up         # Hot-reload dev (app on :3000)
docker compose --profile production up  # Production: MCP server on :3000
# docker-compose.yaml defines only the dev and production profiles (no nginx, no bundled Actual server).
# For a stack that also runs Actual Budget, use docker-compose.test.yaml (it + playwright.config.docker.ts back the test:e2e:docker* scripts).
```

**Pre-commit mandatory**: `npm run build && npm run test:adapter && npm run test:unit-js && npm audit --audit-level=moderate`

**Do NOT run in ephemeral environments**: `test:e2e`, `test:integration:*`, `dev`/`start` (need real `.env`), `release:*`/`docs:sync` (human responsibility only), `deploy:*` (needs Docker). `test:integration:cleanup` deletes test data created by `full`. Only run it after `full` against a test budget.

**Integration test modules** (`tests/manual/tests/`): `sanity` (read-only protocol), `smoke` (balances/categories), `account`, `category-group`, `category`, `payee`, `transaction`, `budget`, `rules`, `schedule`, `batch_uncategorized_rules_upsert`, `advanced` (bank sync, raw SQL).

## Project-Local Agents & Commands

Five **project-specific** subagents live in `.claude/agents/`. Delegate to them via the Agent tool for complex tasks in their domain:

| Agent | When to use |
|-------|-------------|
| `tool-author` | Adding a new MCP tool end-to-end (file, registration, adapter, tests, docs) |
| `qa` | Writing, reviewing, or debugging tests at any layer (unit, integration, E2E, manual) |
| `release-manager` | Version bumps, docs sync, GitHub issue triage, closing fixed tickets |
| `actual-api` | Questions about `@actual-app/api` behaviour, field names, quirks, `withActualApi` lifecycle |
| `ticket-gate` | Readiness gate for GitHub issues. Runs 4 specialist agents to score a ticket before implementation (all must score 10/10) |

Additional generic agents from forge-kit governance also live alongside them (`architect-review`, `code-reviewer`, `security-auditor`, `performance-engineer`, `test-automator`, `tdd-orchestrator`, `dep-auditor`, `health-check`). Use these for cross-cutting reviews; prefer the project-specific agents above whenever the task is in their domain.

Project-local slash commands in `.claude/commands/`:

- `/dep-auditor [--full]`: dependency health audit. Runs Knip, npm registry health, `npm audit`, and version drift checks, then opens GitHub issues for findings (cache-first; `--full` re-audits everything).
- `/local-env`: full local deployment pipeline for the dev environment.
- `/gate-ticket <issue-number>`: runs the ticket readiness gate on a GitHub issue (all 4 specialist agents must score 10/10 before implementation).
- `/ci-health`: checks all GitHub Actions workflows for failures, opens P0 tickets, and auto-fixes safe failures.
- `/full-review [target]`: orchestrates a multi-dimensional code review (architecture, security, performance, testing, best practices).
- `/pr-enhance [PR# or description]`: enhances an existing pull request (description, labels, follow-ups).

## Issue Labels

Every issue carries at least one **area** label (`backend`, `infrastructure`, `security`, `actual-api`, `documentation`; the gate enforces this) and one **priority** label: `P0` (Critical), `P1` (High), `P2` (Medium), `P3` (Low). Speculative, not-yet-committed ideas also get `icebox`. Apply the priority label on triage so the backlog is filterable: `gh issue list --label P1`. The feature and infrastructure issue templates have a Priority dropdown whose selection should be mirrored to the matching label.

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
ActualToolsManager (71 tools, Zod validation, dispatch) at src/actualToolsManager.ts
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

The pool branch only releases its session connection on **infrastructure-level errors** (`Authentication failed`, `ECONNRESET`, `ECONNREFUSED`, `socket hang up`, `ETIMEDOUT`, `ENOMEM`). User-input / domain errors (Zod failures, "field does not exist", "not found") leave the pool entry intact so the next call can reuse it. See `_shouldDropPoolOnError` in `actual-adapter.ts`.

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
6. Update `EXPECTED_TOOL_COUNT` in both `tests/e2e/mcp-client.playwright.spec.ts` and `tests/e2e/docker-all-tools.e2e.spec.ts`; add a happy-path call to `tests/e2e/suites/<domain>.ts`
7. See `docs/NEW_TOOL_CHECKLIST.md` for the full 9-step checklist (includes doc sync, integration test entry, manual-prompt update)

### Key Source Files

| File | Role |
|------|------|
| `src/index.ts` | Entry point, CLI flags, server startup |
| `src/actualToolsManager.ts` | `IMPLEMENTED_TOOLS` registry, Zod dispatch |
| `src/lib/actual-adapter.ts` | **CRITICAL**: `withActualApi` (pool-cooperation since #134), `withActualApiWrite`, retry, concurrency, auth-rate-limit retry |
| `src/lib/ActualConnectionPool.ts` | Up to 15 concurrent sessions, idle timeouts; updates the singleton-state flag in `apiState.ts` |
| `src/lib/apiState.ts` | Shared module-level flag for `@actual-app/api`'s singleton "live" state. Updated by every `init`/`shutdown` path so the adapter can probe whether the pool branch is safe |
| `src/lib/requestContext.ts` | `AsyncLocalStorage<{ sessionId? }>` carrying the active MCP session across async boundaries. Producer: `httpServer.ts`. Consumer: `actual-adapter.ts` (decides pool reuse) |
| `src/server/httpServer.ts` | Express HTTP, StreamableHTTP, Bearer/OIDC auth |
| `src/server/stdioServer.ts` | stdio transport. Logs to stderr, stdout reserved for JSON-RPC |
| `src/auth/setup.ts` | OIDC/JWKS factory (`AUTH_PROVIDER=oidc`) |
| `src/auth/budget-acl.ts` | Per-user budget ACL (email/sub/group principals) |
| `src/config.ts` | Zod environment validation. All config lives here |
| `src/lib/schemas/common.ts` | Shared Zod schemas (`CommonSchemas`) |
| `src/lib/constants.ts` | `UUID_PATTERN`, timeouts, limits |
| `src/lib/retry.ts` | Exponential backoff (3 attempts, 200ms base) |
| `src/lib/loggerFactory.ts` | Module-scoped winston loggers |
| `src/lib/toolFactory.ts` | `createTool()`, the preferred factory for new tools |
| `src/actualConnection.ts` | Actual Budget connection lifecycle |
| `src/lib/errors.ts` | `notFoundMsg()`, `constraintErrorMsg()` helpers |
| `src/observability.ts` | Per-tool call counters (incremented by `createTool`) |
| `src/lib/budget-registry.ts` | Parses `BUDGET_N_*` env vars into budget config list |
| `src/prompts/` | MCP prompt definitions (e.g. `showLargeTransactions`) |
| `src/resources/` | MCP resource definitions (e.g. `accountsSummary`) |
| `src/lib/actual-schema.ts` | Actual Budget DB schema (tables/fields/join paths); source of truth for SQL validation |
| `src/lib/query-validator.ts` | Pre-validates SQL queries against `actual-schema` before execution to prevent server crashes |

## Key Conventions & Gotchas

**Logging (structured, since #219)**: use `createModuleLogger('MODULE')` from `src/lib/loggerFactory.js`; never call `console.*` directly in source (the console is hijacked to winston for stdio framing safety). Pass structured context as the metadata object (`log.info('did x', { sessionId, count })`), not interpolated into the message, so it is queryable. Levels: `error` (a failure needing attention), `warn` (recoverable/suspicious), `info` (normal lifecycle), `debug` (developer internals). Output format is resolved in `src/logger.ts` straight from `process.env` (it loads before `config.ts`): `LOG_FORMAT=json|pretty`, precedence explicit `LOG_FORMAT` > `NODE_ENV=production` (json) > pretty. JSON records carry `{ timestamp, level, service, module, message, stack?, sessionId?, requestId?, context }`. The `sessionId`/`requestId` correlation fields (#221) are stamped automatically from `requestContext` on every line within an HTTP request (an inbound `X-Correlation-ID` header is honored, else a UUID is generated); they are reserved top-level fields, so do not pass `sessionId`/`requestId` as your own metadata (the request value wins). The format helpers `resolveLogConfig` / `buildLogFormat` are exported and unit-tested in `tests/unit/logger_structured.test.js`. Secrets are redacted centrally (#220): a `redactSecrets` winston format (in `buildLogFormat`, after `splat()`) masks any key named `authorization`/`token`/`password`/`cookie`/`secret`/`*-secret`/`client_secret` (and similar) at any depth, plus the actual configured secret values (`MCP_SSE_AUTHORIZATION`, `ACTUAL_PASSWORD`, `*_PASSWORD`, `*_SECRET`), to `[REDACTED]`. Still avoid logging secrets deliberately, but the central format is the backstop. To protect a new sensitive field, name it with one of those suffixes or add it to `SENSITIVE_KEYS` in `src/logger.ts`.

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

## Documentation Map

- `docs/ARCHITECTURE.md`: component layers, data flow, transport protocols
- `docs/NEW_TOOL_CHECKLIST.md`: canonical 9-step guide for adding tools
- `docs/TESTING_AND_RELIABILITY.md`: test-file inventory, integration test module table
- `docs/guides/AI_CLIENT_SETUP.md`: LibreChat/LobeChat setup, Docker networking, TLS, OIDC/ACL
- `docs/guides/MCP_CLIENTS_SETUP.md`: per-client setup recipes (Claude Desktop, Cursor, etc.); complements AI_CLIENT_SETUP.md
- `docs/audit/dep-audit-cache.json`: cache used by `/dep-auditor` to skip recently-checked libraries; do not edit manually
- `docs/guides/DEPLOYMENT.md`: Docker Compose profiles, Kubernetes, upgrade steps
- `docs/SECURITY_AND_PRIVACY.md`: auth models, threat model
- `tests/manual-prompt/`: three prompt files for LLM-driven end-to-end verification (paste sequentially into an AI chat); update when adding tools
- `docker/description/long.md`, `docker/description/short.md`: Docker Hub descriptions; managed by `npm run docs:sync`
- `.env.example`: all environment variables with inline documentation
