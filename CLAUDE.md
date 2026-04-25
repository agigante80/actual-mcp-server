# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Actual MCP Server** bridges AI assistants with [Actual Budget](https://actualbudget.org/) via the Model Context Protocol (MCP), exposing **63 tools** for conversational financial management. Supports two transports: **HTTP** (for LibreChat/LobeChat/multi-user deployments) and **stdio** (for Claude Desktop/Claude Code local use — pass `--stdio` flag).

**Tech Stack**: TypeScript (NodeNext/ESM), Node.js 20+, `@actual-app/api` v26, `@modelcontextprotocol/sdk`, Express 5, Zod v4, Playwright

## Git Workflow

**Always work on `develop`, never push directly to `main`.**

- All changes go to the `develop` branch
- Push to `origin/develop` after every commit
- `main` is only updated with explicit user permission (e.g. "push to main" or "release")
- When the user says "push to github" without specifying a branch → push to `develop`

## Commands

```bash
# Build & Run
npm run build                   # TypeScript compilation (required before running)
npm run dev -- --http --debug   # Dev mode with HTTP transport + debug logs
npm run dev -- --stdio --debug  # Dev mode with stdio transport (for Claude Desktop/Code)
npm run start                   # Production HTTP (requires build first)
node dist/src/index.js --stdio  # Production stdio

# Testing (validation sequence — run in this order)
npm run build                   # Step 1: must compile cleanly
npm run verify-tools            # Step 2: all 63 tools registered (reads dist/)
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
docker compose --profile dev up         # Hot-reload dev
docker compose --profile production up  # Nginx proxy on :3600
docker compose --profile fullstack up   # Includes Actual Budget server on :5006
# docker-compose.test.yaml + playwright.config.docker.ts are used by test:e2e:docker* scripts
```

**Pre-commit mandatory**: `npm run build && npm run test:adapter && npm run test:unit-js && npm audit --audit-level=moderate`

**Do NOT run in ephemeral environments**: `test:e2e`, `test:integration:*`, `dev`/`start` (need real `.env`), `release:*`/`docs:sync` (human responsibility only), `deploy:*` (needs Docker). `test:integration:cleanup` deletes test data created by `full` — only run after `full` against a test budget.

**Integration test modules** (`tests/manual/tests/`): `sanity` (read-only protocol), `smoke` (balances/categories), `account`, `category-group`, `category`, `payee`, `transaction`, `budget`, `rules`, `schedule`, `batch_uncategorized_rules_upsert`, `advanced` (bank sync, raw SQL).

## Project-Local Agents & Commands

Five specialized subagents live in `.claude/agents/` — delegate to them via the Agent tool for complex tasks in their domain:

| Agent | When to use |
|-------|-------------|
| `tool-author` | Adding a new MCP tool end-to-end (file, registration, adapter, tests, docs) |
| `qa` | Writing, reviewing, or debugging tests at any layer (unit, integration, E2E, manual) |
| `release-manager` | Version bumps, docs sync, GitHub issue triage, closing fixed tickets |
| `actual-api` | Questions about `@actual-app/api` behaviour, field names, quirks, `withActualApi` lifecycle |
| `ticket-gate` | Readiness gate for GitHub issues — runs 4 specialist agents to score a ticket before implementation (all must score 10/10) |

Project-local slash commands in `.claude/commands/`:

- `/dep-auditor [--full]` — dependency health audit: runs Knip, npm registry health, `npm audit`, and version drift checks, then opens GitHub issues for findings (cache-first; `--full` re-audits everything)
- `/local-env` — full local deployment pipeline for the dev environment
- `/review-ticket <issue-number>` — runs the ticket readiness gate on a GitHub issue number

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
ActualToolsManager — 63 tools, Zod validation, dispatch (src/actualToolsManager.ts)
    ↓
actual-adapter.ts — withActualApi wrapper, retry (3x), concurrency limit (5)
    ↓
@actual-app/api v26 → Actual Budget Server
```

**Transport is selected via CLI flag** (`--http` or `--stdio`); they are mutually exclusive. The `--stdio` flag sets `MCP_STDIO_MODE=true` **before** importing the logger so that all log output is routed to stderr (stdout is reserved for JSON-RPC framing).

### Critical Pattern: `withActualApi` Wrapper

**Every Actual API operation MUST use `withActualApi()`** from `src/lib/actual-adapter.ts`. Actual Budget requires `api.shutdown()` after every operation to commit data — the wrapper handles the full init → operation → shutdown lifecycle.

```typescript
// ✅ CORRECT
await withActualApi(async () => { return await rawAddTransactions(data); });

// ❌ WRONG — data won't persist (tombstone issue)
await rawAddTransactions(data);
```

### Tool Structure Pattern

New tools should use `createTool()` from `src/lib/toolFactory.ts` — it wires up error handling, logging, and observability automatically:

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

Many existing tools still use the older pattern — both work, but `createTool()` is preferred for new tools:

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
2. Export it from `src/tools/index.ts` (e.g. `export { default as new_tool } from './new_tool.js';`)
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
| `src/lib/actual-adapter.ts` | **CRITICAL**: `withActualApi`, retry, concurrency |
| `src/lib/ActualConnectionPool.ts` | Up to 15 concurrent sessions, idle timeouts |
| `src/server/httpServer.ts` | Express HTTP, StreamableHTTP, Bearer/OIDC auth |
| `src/server/stdioServer.ts` | stdio transport — logs to stderr, stdout for JSON-RPC |
| `src/auth/setup.ts` | OIDC/JWKS factory (`AUTH_PROVIDER=oidc`) |
| `src/auth/budget-acl.ts` | Per-user budget ACL (email/sub/group principals) |
| `src/config.ts` | Zod environment validation — all config lives here |
| `src/lib/schemas/common.ts` | Shared Zod schemas (`CommonSchemas`) |
| `src/lib/constants.ts` | `UUID_PATTERN`, timeouts, limits |
| `src/lib/retry.ts` | Exponential backoff (3 attempts, 200ms base) |
| `src/lib/toolFactory.ts` | `createTool()` — preferred factory for new tools |
| `src/lib/errors.ts` | `notFoundMsg()`, `constraintErrorMsg()` helpers |
| `src/observability.ts` | Per-tool call counters (incremented by `createTool`) |
| `src/lib/budget-registry.ts` | Parses `BUDGET_N_*` env vars into budget config list |
| `src/prompts/` | MCP prompt definitions (e.g. `showLargeTransactions`) |
| `src/resources/` | MCP resource definitions (e.g. `accountsSummary`) |
| `src/lib/actual-schema.ts` | Actual Budget DB schema (tables/fields/join paths) — source of truth for SQL validation |
| `src/lib/query-validator.ts` | Pre-validates SQL queries against `actual-schema` before execution to prevent server crashes |

## Key Conventions & Gotchas

**Amounts are always in integer cents**: `5000 = $50.00`, `-5000 = -$50.00`. Never use decimal dollars.

**`MCP_SSE_AUTHORIZATION` must be the raw token only** — not `"Bearer token123"`. The server extracts the token from the `Authorization: Bearer <token>` header and compares directly.

**`MCP_ENABLE_HTTPS=true`** enables native TLS — set `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY` to PEM file paths. A reverse proxy is still preferred for production (certificate rotation, SNI), but native TLS works for simple single-host deployments.

**Date fields require `YYYY-MM-DD` strings** — never use `Date.now()` (produces a number).

**Multi-budget mode**: `BUDGET_N_NAME`, `BUDGET_N_SYNC_ID`, `BUDGET_N_SERVER_URL`, `BUDGET_N_PASSWORD`, `BUDGET_N_ENCRYPTION_PASSWORD` (N = 1, 2, 3…). Server URL and password fall back to the default `ACTUAL_*` vars if omitted.

**`mcp-remote` requires `--allow-http`** for HTTP connections — it enforces HTTPS by default. Without the flag, clients see `URL must use HTTPS`. Some versions of Claude Desktop also enforce HTTPS at the app level; in that case, switch to native TLS (`MCP_ENABLE_HTTPS=true`).

**Documentation hygiene**: Prefer deletion over archiving. When a feature ships, delete its `docs/feature/*.md` spec and remove its row from `docs/ROADMAP.md`. Never move to `archive/` folders — git history is the archive.

**Version/tool count markers** (`**Version:**`, `**Tool Count:**`) across all docs are managed automatically by `scripts/version-bump.js` on `release:*` / `docs:sync`. Never edit them manually.

**`npm overrides` are a last resort for security CVEs only.** Prefer upgrading the direct dependency that pulls in the vulnerable transitive. If an override is unavoidable (no direct-dep upgrade available), add it with an explanation in `package.json`'s `"comments"."security-overrides"` field (see existing `ajv`/`qs` entries as the pattern). Never use overrides to resolve non-security version drift.

**Session tools are the only exception to `withActualApi`**: `actual_session_list` and `actual_session_close` call `connectionPool` directly — they manage the pool itself, not budget data, so they skip the wrapper intentionally.

**If transactions/budgets don't persist**: verify `withActualApi` wraps the call (grep for `rawAdd*` / `rawUpdate*` called without it), confirm `api.shutdown()` runs after the operation, and check logs for "tombstone" errors. The `getConcurrencyState()` export from `actual-adapter.ts` shows `{ active, queued, limit }` for diagnosing concurrency back-pressure.

## File Safety Tiers

**Safe to modify**: `src/tools/*.ts`, `tests/**`, `docs/**/*.md`, `README.md`, `.env.example`, `docker-compose.yaml`, `examples/mcp-clients/**` (6 client config examples — update when transport/auth changes)

**Modify with caution** (test thoroughly): `src/lib/actual-adapter.ts` (affects all tools), `src/actualToolsManager.ts` (run `verify-tools` after), `src/server/*.ts` (verify with MCP client), `src/index.ts`, `src/actualConnection.ts`

**Do not modify without explicit permission**: `types/*.d.ts`, `generated/**/*` (auto-generated), `scripts/version-bump.js`, `VERSION`

## Documentation Sync

When changing code, update these docs:

| Change | Required updates |
|--------|-----------------|
| New tool | `README.md` (count + table), `docs/PROJECT_OVERVIEW.md`, `docs/ARCHITECTURE.md` tool list, `tests/e2e/docker-all-tools.e2e.spec.ts` (describe block name) |
| New env var | `.env.example`, `docs/ARCHITECTURE.md` config section, `README.md` env table |
| Auth/security change | `docs/SECURITY_AND_PRIVACY.md`, `docs/guides/AI_CLIENT_SETUP.md` |
| Docker change | `docs/ARCHITECTURE.md`, `README.md`, `docs/guides/DEPLOYMENT.md` |
| New feature shipped | `docs/PROJECT_OVERVIEW.md`, delete its `docs/feature/*.md` spec, remove from `docs/ROADMAP.md` |
| New tool added | `tests/manual-prompt/prompt-{1\|2\|3}-*.txt` (add positive + negative scenario, update phase count); `tests/manual-prompt/README.md` Phase Overview total; run `npm run docs:sync` (updates `docker/description/long.md`, `docker/description/short.md`, and all `**Tool Count:**` markers) |
| Test module added | `docs/TESTING_AND_RELIABILITY.md` (test-file table) |

## Documentation Map

- `docs/ARCHITECTURE.md` — component layers, data flow, transport protocols
- `docs/NEW_TOOL_CHECKLIST.md` — canonical 9-step guide for adding tools
- `docs/TESTING_AND_RELIABILITY.md` — test-file inventory, integration test module table
- `docs/guides/AI_CLIENT_SETUP.md` — LibreChat/LobeChat setup, Docker networking, TLS, OIDC/ACL
- `docs/guides/DEPLOYMENT.md` — Docker Compose profiles, Kubernetes, upgrade steps
- `docs/SECURITY_AND_PRIVACY.md` — auth models, threat model
- `tests/manual-prompt/` — three prompt files for LLM-driven end-to-end verification (paste sequentially into an AI chat); update when adding tools
- `docker/description/long.md`, `docker/description/short.md` — Docker Hub descriptions; managed by `npm run docs:sync`
- `.env.example` — all environment variables with inline documentation
