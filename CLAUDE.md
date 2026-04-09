# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Actual MCP Server** bridges AI assistants with [Actual Budget](https://actualbudget.org/) via the Model Context Protocol (MCP), exposing **62 tools** for conversational financial management. Built for LibreChat/LobeChat but compatible with any MCP client via HTTP transport.

**Tech Stack**: TypeScript (NodeNext/ESM), Node.js 20+, `@actual-app/api` v26, `@modelcontextprotocol/sdk`, Express 5, Zod v4, Playwright

## Commands

```bash
# Build & Run
npm run build                   # TypeScript compilation (required before running)
npm run dev -- --http --debug   # Dev mode with HTTP transport + debug logs
npm run start                   # Production (requires build first)

# Testing (validation sequence — run in this order)
npm run build                   # Step 1: must compile cleanly
npm run verify-tools            # Step 2: all 62 tools registered (reads dist/)
npm run test:unit-js            # Step 3: unit + schema tests
npm audit --audit-level=moderate # Step 4: no new vulnerabilities

# Individual test commands
npm run test:adapter            # Adapter: retry, concurrency, init/shutdown
node tests/unit/transactions_create.test.js   # Single unit test file
npx playwright test --grep "initialize -> tools/list"  # Single E2E test
npm run test:e2e                # Full Playwright E2E (requires no live server)
npm run test:integration:smoke  # Live server integration (smoke level)

# Tools
npm run verify-tools            # Verify tool count + registration
npm run check:coverage          # List @actual-app/api methods vs tool coverage
npm run test:mcp-client         # Connect as MCP client and exercise tools

# Manual connection tests (requires .env)
npm run dev -- --test-actual-connection  # Test Actual Budget connection only
npm run dev -- --test-actual-tools       # Exercise all 62 tools against live server

# Docker
docker compose --profile dev up         # Hot-reload dev
docker compose --profile production up  # Nginx proxy on :3600
docker compose --profile fullstack up   # Includes Actual Budget server on :5006
```

**Pre-commit mandatory**: `npm run build && npm run test:adapter && npm run test:unit-js && npm audit --audit-level=moderate`

**Do NOT run in ephemeral environments**: `test:e2e`, `test:integration:*`, `dev`/`start` (need real `.env`), `release:*`/`docs:sync` (human responsibility only), `deploy:*` (needs Docker).

## Architecture

### Layered Design

```
AI Client (LibreChat/LobeChat)
    ↓ HTTP/MCP JSON-RPC
Express + StreamableHTTP (src/server/httpServer.ts)
    ↓
ActualMCPConnection (src/lib/ActualMCPConnection.ts)
    ↓
ActualToolsManager — 62 tools, Zod validation, dispatch (src/actualToolsManager.ts)
    ↓
actual-adapter.ts — withActualApi wrapper, retry (3x), concurrency limit (5)
    ↓
@actual-app/api v26 → Actual Budget Server
```

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

Many existing tools still use the older pattern (manual `ToolDefinition` export with `call:` and `inputSchema:`). Both work, but `createTool()` is preferred for new tools.

### Adding a New Tool

1. Create `src/tools/new_tool.ts` using the pattern above
2. Add tool name to `IMPLEMENTED_TOOLS` array in `src/actualToolsManager.ts`
3. Add unit tests in `tests/unit/` (positive + negative cases)
4. Run `npm run verify-tools` to confirm registration
5. See `docs/NEW_TOOL_CHECKLIST.md` for the full 9-step checklist (includes doc sync, integration test entry)

### Key Source Files

| File | Role |
|------|------|
| `src/index.ts` | Entry point, CLI flags, server startup |
| `src/actualToolsManager.ts` | `IMPLEMENTED_TOOLS` registry, Zod dispatch |
| `src/lib/actual-adapter.ts` | **CRITICAL**: `withActualApi`, retry, concurrency |
| `src/lib/ActualConnectionPool.ts` | Up to 15 concurrent sessions, idle timeouts |
| `src/server/httpServer.ts` | Express HTTP, StreamableHTTP, Bearer/OIDC auth |
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

## Key Conventions & Gotchas

**Amounts are always in integer cents**: `5000 = $50.00`, `-5000 = -$50.00`. Never use decimal dollars.

**`MCP_SSE_AUTHORIZATION` must be the raw token only** — not `"Bearer token123"`. The server extracts the token from the `Authorization: Bearer <token>` header and compares directly.

**`MCP_ENABLE_HTTPS=true`** enables native TLS — set `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY` to PEM file paths. A reverse proxy is still preferred for production (certificate rotation, SNI), but native TLS works for simple single-host deployments.

**Date fields require `YYYY-MM-DD` strings** — never use `Date.now()` (produces a number).

**Multi-budget mode**: `BUDGET_N_NAME`, `BUDGET_N_SYNC_ID`, `BUDGET_N_SERVER_URL`, `BUDGET_N_PASSWORD`, `BUDGET_N_ENCRYPTION_PASSWORD` (N = 1, 2, 3…). Server URL and password fall back to the default `ACTUAL_*` vars if omitted.

**`mcp-remote` requires `--allow-http`** for HTTP connections — it enforces HTTPS by default. Without the flag, clients see `URL must use HTTPS`. Some versions of Claude Desktop also enforce HTTPS at the app level; in that case, switch to native TLS (`MCP_ENABLE_HTTPS=true`).

**Documentation hygiene**: Prefer deletion over archiving. When a feature ships, delete its `docs/feature/*.md` spec and remove its row from `docs/ROADMAP.md`. Never move to `archive/` folders — git history is the archive.

**Version/tool count markers** (`**Version:**`, `**Tool Count:**`) across all docs are managed automatically by `scripts/version-bump.js` on `release:*` / `docs:sync`. Never edit them manually.

## File Safety Tiers

**Safe to modify**: `src/tools/*.ts`, `tests/**`, `docs/**/*.md`, `README.md`, `.env.example`, `docker-compose.yaml`

**Modify with caution** (test thoroughly): `src/lib/actual-adapter.ts` (affects all tools), `src/actualToolsManager.ts` (run `verify-tools` after), `src/server/*.ts` (verify with MCP client), `src/index.ts`, `src/actualConnection.ts`

**Do not modify without explicit permission**: `types/*.d.ts`, `generated/**/*` (auto-generated), `scripts/version-bump.js`, `VERSION`

## Documentation Sync

When changing code, update these docs:

| Change | Required updates |
|--------|-----------------|
| New tool | `README.md` (count + table), `docs/PROJECT_OVERVIEW.md`, `docs/ARCHITECTURE.md` tool list |
| New env var | `.env.example`, `docs/ARCHITECTURE.md` config section, `README.md` env table |
| Auth/security change | `docs/SECURITY_AND_PRIVACY.md`, `docs/guides/AI_CLIENT_SETUP.md` |
| Docker change | `docs/ARCHITECTURE.md`, `README.md`, `docs/guides/DEPLOYMENT.md` |
| New feature shipped | `docs/PROJECT_OVERVIEW.md`, delete its `docs/feature/*.md` spec, remove from `docs/ROADMAP.md` |

## Documentation Map

- `docs/ARCHITECTURE.md` — component layers, data flow, transport protocols
- `docs/NEW_TOOL_CHECKLIST.md` — canonical 9-step guide for adding tools
- `docs/guides/AI_CLIENT_SETUP.md` — LibreChat/LobeChat setup, Docker networking, TLS, OIDC/ACL
- `docs/guides/DEPLOYMENT.md` — Docker Compose profiles, Kubernetes, upgrade steps
- `docs/SECURITY_AND_PRIVACY.md` — auth models, threat model
- `.env.example` — all environment variables with inline documentation
