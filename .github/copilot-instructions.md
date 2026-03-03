# Copilot Instructions for Actual MCP Server

## Project Overview

**Actual MCP Server** bridges AI assistants with [Actual Budget](https://actualbudget.org/) via the Model Context Protocol (MCP), providing **56 tools** for conversational financial management. Built for LibreChat but MCP-compatible with any client.

**Tech Stack**: TypeScript (NodeNext), Node.js 20+, `@actual-app/api`, `@modelcontextprotocol/sdk`, Express, Zod schemas, Playwright tests

**Current Status**: Production-ready, 56 tools implemented, 84% Actual Budget API coverage

## Architecture Essentials

### Critical Pattern: `withActualApi` Wrapper

**Every Actual API operation MUST use `withActualApi()` wrapper** from `src/lib/actual-adapter.ts`:

```typescript
// ✅ CORRECT - ensures data persistence
await withActualApi(async () => {
  return await rawAddTransactions(data);
});

// ❌ WRONG - data won't persist (tombstone issue)
await rawAddTransactions(data);
```

**Why**: Actual Budget requires `api.shutdown()` after every operation to commit data. The `withActualApi` wrapper handles init/shutdown lifecycle automatically. Based on [s-stefanov/actual-mcp](https://github.com/s-stefanov/actual-mcp) pattern.

### Tool Structure

All 56 tools follow this pattern (`src/tools/*.ts`):

```typescript
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  account: CommonSchemas.accountId,
  amount: CommonSchemas.amountCents, // always in cents
});

const tool: ToolDefinition = {
  name: 'actual_transactions_create',
  description: 'Create transaction. Amount in cents (negative=expense, positive=income).',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    return await adapter.addTransactions(input);
  },
};

export default tool;
```

**Key conventions**:
- Tool names: `actual_{domain}_{action}` (e.g., `actual_accounts_create`)
- Amounts: **always in cents** (integer), never dollars
- Dates: `YYYY-MM-DD` format (validated by `CommonSchemas.date`)
- UUIDs: Validated with `UUID_PATTERN` from `src/lib/constants.ts`
- Shared schemas: Use `CommonSchemas` from `src/lib/schemas/common.ts` for consistency

### Module Organization

```
src/
├── index.ts                    # Entry point, CLI parsing, server startup
├── actualConnection.ts         # Actual Budget connection lifecycle
├── actualToolsManager.ts       # Tool registry (56 tools in IMPLEMENTED_TOOLS array), dispatch, validation
├── auth/
│   ├── setup.ts                # createMcpAuth() factory (MCPAuth singleton, AUTH_PROVIDER=oidc)
│   └── budget-acl.ts           # Per-user budget ACL (email/sub/group principals, AUTH_BUDGET_ACL)
├── lib/
│   ├── actual-adapter.ts       # ⚠️ CRITICAL: withActualApi wrapper, retry logic
│   ├── ActualMCPConnection.ts  # MCP protocol implementation (EventEmitter-based)
│   ├── retry.ts                # Exponential backoff retry (3 attempts, 200ms base)
│   ├── constants.ts            # All configuration constants, patterns, limits
│   ├── schemas/common.ts       # Shared Zod schemas (accountId, amountCents, etc.)
│   └── loggerFactory.ts        # Module-scoped loggers (winston)
├── server/
│   └── httpServer.ts           # HTTP transport
└── tools/                      # 56 tool definitions (see actualToolsManager.ts)
```

## Development Workflow

### Build & Run Commands

```bash
npm run build                   # TypeScript compilation (required before running)
npm run dev -- --http --debug   # Development mode with HTTP transport + debug logs
npm run start                   # Production mode (requires build first)

# Testing
npm run test:adapter            # Adapter smoke tests (concurrency, retry logic)
npm run test:unit-js            # Unit tests for transactions
npm run test:e2e                # Playwright E2E tests (initialize → tools/call → streaming)

# Tool Management
npm run generate-tools          # Auto-generate tool definitions from Actual API
npm run verify-tools            # Verify all 56 tools are correctly registered

# Docs & Release
npm run docs:sync               # Sync **Version:** and **Tool Count:** markers in all docs
npm run release:patch           # Bump patch version + auto-sync docs markers
npm run release:minor           # Bump minor version + auto-sync docs markers
npm run release:major           # Bump major version + auto-sync docs markers

# Deployment (periodic maintenance)
npm run deploy:full             # Full redeploy: build image → pull → recreate → health check
npm run deploy:smoke            # Smoke-only: health check + integration tests (no rebuild)
```

### Pre-Commit Testing Policy

**MANDATORY before every commit** (from `docs/AI_INTERACTION_GUIDE.md`):

```bash
npm run build                   # ✅ No TypeScript errors
npm run test:adapter            # ✅ Adapter tests pass
npm run test:unit-js            # ✅ Unit tests pass
npm audit --audit-level=moderate # ✅ No critical vulnerabilities
```

**Exception**: Documentation-only changes (no code modified)

### Docker Development

```bash
# Development with hot-reload
docker compose --profile dev up

# Production with Nginx proxy (connection pooling)
docker compose --profile production up

# Full stack (includes Actual Budget server)
docker compose --profile fullstack up
```

Default ports: HTTP (3000), Nginx proxy (3600), Actual Budget (5006)

## Common Patterns & Gotchas

### 1. Amount Handling

```typescript
// ✅ CORRECT - amounts in cents
const expense = -5000;  // -$50.00
const income = 10000;   // $100.00

// ❌ WRONG - never use decimal dollars
const expense = -50.00; // Will create -0.50 transaction!
```

### 2. Error Handling with Retry

The adapter includes automatic retry logic (3 attempts, exponential backoff):

```typescript
// Retry is automatic in adapter functions
await adapter.addTransactions(data); // Auto-retries on transient failures

// For custom operations, use retry() from src/lib/retry.ts
import retry from './lib/retry.js';
const result = await retry(() => riskyOperation(), { retries: 3, backoffMs: 200 });
```

### 3. Concurrency Control

The adapter enforces concurrency limits (default: 5) to prevent Actual API overload:

```typescript
// Managed automatically by callWithRetry in actual-adapter.ts
// Check state with:
import { getConcurrencyState } from './lib/actual-adapter.js';
console.log(getConcurrencyState()); // { active: 2, queued: 0, limit: 5 }
```

### 4. Environment Configuration

Required variables (`.env`):

```bash
ACTUAL_SERVER_URL=http://localhost:5006  # Actual Budget server
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=uuid-from-actual   # Settings → Sync ID
ACTUAL_BUDGET_PASSWORD=                  # Optional budget encryption password
MCP_TRANSPORT_MODE=http                  # only http is supported
MCP_SSE_AUTHORIZATION=Bearer token123    # Optional Bearer token auth
```

See `src/config.ts` for validation schema.

### 5. Tool Registration

New tools auto-register via `actualToolsManager.ts`:

```typescript
// 1. Create tool definition in src/tools/my_new_tool.ts
export default tool;

// 2. Import and add to IMPLEMENTED_TOOLS array in actualToolsManager.ts
const IMPLEMENTED_TOOLS = [
  'actual_accounts_create',
  'actual_my_new_tool',  // ← Add here
  // ...
];

// 3. Verify registration
npm run verify-tools
```

All 6 ActualQL-powered search/summary tools are registered:
`actual_transactions_search_by_amount`, `actual_transactions_search_by_category`,
`actual_transactions_search_by_month`, `actual_transactions_search_by_payee`,
`actual_transactions_summary_by_category`, `actual_transactions_summary_by_payee`.

### 6. LibreChat Testing Pain Points

**Problem**: Testing MCP tools with LibreChat is trial-and-error due to:
- No native LibreChat test mode for MCP servers
- Difficult to see actual tool parameters sent
- Error messages often unhelpful
- No way to replay specific tool calls

**Current Testing Workflow**:
```bash
# 1. Start server with debug logging
npm run dev -- --http --debug

# 2. Watch logs in real-time
tail -f logs/app-YYYY-MM-DD.log | grep -i "tool\|error"

# 3. Test in LibreChat UI
# - Open chat with MCP server enabled
# - Try tool invocations
# - Check logs for actual parameters

# 4. Use Playwright E2E tests to simulate LibreChat
npm run test:e2e  # Spawns server, tests full MCP flow
```

**Best Practices**:
- Always run with `--debug` flag during development
- Use `test:e2e` to verify MCP protocol compliance before LibreChat testing
- Check `logs/` directory for full request/response traces
- Test one tool at a time, verify in Actual Budget UI immediately
- Use `actual_server_info` tool to verify connection before complex operations

**Common LibreChat Issues**:
1. **Tools don't load**: Check `MCP_TRANSPORT_MODE=http` in server env
2. **Auth failures**: Verify `MCP_SSE_AUTHORIZATION` token is correct
3. **Timeout errors**: Increase `DEFAULT_OPERATION_TIMEOUT_MS` in `src/lib/constants.ts`
4. **Silent failures**: Tool succeeded but no UI feedback - check LibreChat logs

## Testing Strategies

### E2E Tests (Playwright)

Located in `tests/e2e/mcp-client.playwright.spec.ts`:

- Spawns MCP server as child process
- Tests full MCP protocol flow: initialize → tools/list → tools/call → streaming response
- Waits for server readiness (30s timeout)
- Validates JSON-RPC responses

```typescript
// Run single test
npx playwright test --grep "initialize -> tools/list"
```

### Adapter Tests

Located in `src/tests_adapter_runner.ts`:

- Tests `withActualApi` wrapper behavior
- Validates retry logic (flaky operation recovery)
- Checks concurrency limits (queue management)

### Manual Testing

```bash
# Test Actual connection only
npm run dev -- --test-actual-connection

# Test all 56 tools
npm run dev -- --test-actual-tools
```

## Documentation Standards

**Sync Policy**: Update docs when changing code behavior (from `docs/AI_INTERACTION_GUIDE.md`):

- **Architecture changes** → Update `docs/ARCHITECTURE.md`
- **New features** → Update `README.md` + `docs/PROJECT_OVERVIEW.md`
- **Testing changes** → Update `docs/TESTING_AND_RELIABILITY.md`
- **Security changes** → Update `docs/SECURITY_AND_PRIVACY.md`

**Version & Tool Count Sync**: `scripts/version-bump.js` auto-updates `**Version:**` and
`**Tool Count:**` markers across all docs on every `release:*` bump or `docs:sync` run.
Never manually edit these markers — run `npm run docs:sync` instead.

**Documentation Location**: Comprehensive docs in `/docs/` directory:
- `AI_INTERACTION_GUIDE.md` - AI agent rules (mandatory testing policies)
- `ARCHITECTURE.md` - Component layers, data flow, transport protocols
- `PROJECT_OVERVIEW.md` - Features, roadmap, assessment (88/100 score)
- `NEW_TOOL_CHECKLIST.md` - Step-by-step checklist for adding a new tool (9 steps)

## Key Files to Review

When working on specific areas, reference these files:

**Adding Tools**: `src/actualToolsManager.ts`, `src/tools/*.ts`, `src/lib/schemas/common.ts`, `docs/NEW_TOOL_CHECKLIST.md`  
**Transport Issues**: `src/server/httpServer.ts`  
**OIDC/Auth**: `src/auth/setup.ts`, `src/auth/budget-acl.ts`, `src/config.ts` (AUTH_PROVIDER etc.)  
**API Integration**: `src/lib/actual-adapter.ts` (withActualApi pattern), `src/lib/retry.ts`  
**Testing**: `tests/e2e/mcp-client.playwright.spec.ts`, `src/tests_adapter_runner.ts`, `tests/manual/` (live integration suite)  
**Deployment**: `scripts/deploy-and-test.sh`, `docker-compose.yaml`  
**Configuration**: `src/config.ts`, `.env.example`

## Common Tasks

### Add a New Tool

> **Follow `docs/NEW_TOOL_CHECKLIST.md`** — the canonical 9-step guide covering
> implementation, unit tests (positive + negative), manual integration tests,
> AI prompt update, all required doc files, and final validation.

Quick summary:
1. Create `src/tools/new_tool.ts` using the pattern above
2. Add tool name to `IMPLEMENTED_TOOLS` in `src/actualToolsManager.ts`
3. Add unit tests in `tests/unit/` (positive + at least one negative case)
4. Add integration test entry in `tests/manual/tests/` following `tests/manual/README.md`
5. Run `npm run verify-tools` to confirm registration
6. Run `npm run build && npm run test:adapter && npm run test:unit-js` before committing
7. Run `npm run docs:sync` to update **Tool Count:** markers in all docs

### Fix LibreChat Integration Issue

- **Check transport**: LibreChat requires HTTP transport (`--http` flag)
- **Review logs**: Debug mode (`--debug`) shows all MCP requests/responses
- **Test locally**: Use `tests/e2e/mcp-client.playwright.spec.ts` to reproduce

### Debug Data Persistence

If transactions/budgets don't persist:
1. Verify `withActualApi` wrapper is used (grep for `rawAdd*` calls)
2. Check `api.shutdown()` is called after operations
3. Review logs for "tombstone" errors
4. Ensure `withActualApi` wrapper properly handles init/shutdown lifecycle

---

**Last Updated**: 2026-03-03  
**Version:** 0.4.20  
**Tool Count:** 56 (verified LibreChat-compatible)
