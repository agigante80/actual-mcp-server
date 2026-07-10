# Architecture

**Project:** Actual MCP Server  
**Version:** 0.8.13  
**Last Updated:** 2026-06-07

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Component Overview](#component-overview)
- [Data Flow](#data-flow)
- [Module Structure](#module-structure)
- [Execution Lifecycle](#execution-lifecycle)
- [Configuration](#configuration)
- [Transport Protocols](#transport-protocols)
- [Error Handling](#error-handling)
- [Performance & Reliability](#performance-reliability)

---

## System Architecture

### High-Level Diagram

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│                 │   MCP   │                  │  REST   │                 │
│  MCP Client     │◄────────┤  Actual MCP      │◄────────┤  Actual Budget  │
│  (LibreChat)    │         │  Server          │         │  Server         │
│                 │         │                  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     │ SQLite
                                     ▼
                            ┌─────────────────┐
                            │   Local Cache   │
                            │  (Budget Data)  │
                            └─────────────────┘
```

### Component Layers

```
┌───────────────────────────────────────────────────────────┐
│              Client Layer (LibreChat, etc.)               │
└───────────────────────────────────────────────────────────┘
                            │
                   HTTP / WebSocket
                            ▼
┌───────────────────────────────────────────────────────────┐
│               Transport Layer                             │
│  ┌──────────┐                                     │
│  │   HTTP   │                                     │
│  │  Server  │                                     │
│  └──────────┘                                     │
└───────────────────────────────────────────────────────────┘
                            │
                       MCP Protocol
                            ▼
┌───────────────────────────────────────────────────────────┐
│            MCP Protocol Layer                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │         ActualMCPConnection                        │  │
│  │  (Request routing, response handling)              │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            │
                        Tool Calls
                            ▼
┌───────────────────────────────────────────────────────────┐
│            Business Logic Layer                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │         ActualToolsManager                         │  │
│  │  (Tool registry, validation, dispatch)             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐           │
│  │Tool1│  │Tool2│  │Tool3│  │ ... │  │ 70  │           │
│  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘           │
└───────────────────────────────────────────────────────────┘
                            │
                      Adapter Functions
                            ▼
┌───────────────────────────────────────────────────────────┐
│              Data Access Layer                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Actual Adapter                             │  │
│  │  (Retry logic, concurrency control, error mapping)│  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            │
                      @actual-app/api
                            ▼
┌───────────────────────────────────────────────────────────┐
│            External API Layer                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Actual Budget API Client                   │  │
│  │  (Official @actual-app/api package)                │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            │
                    REST API / SQLite
                            ▼
┌───────────────────────────────────────────────────────────┐
│                Actual Budget Server                       │
│                    (External Service)                     │
└───────────────────────────────────────────────────────────┘
```

---

## Component Overview

### Core Modules

| Module | File | Responsibility | Key Functions |
|--------|------|----------------|---------------|
| **Main Entry** | `src/index.ts` | Orchestration, CLI parsing, server startup | `main()` |
| **Connection Manager** | `src/actualConnection.ts` | Actual Budget API lifecycle | `connectToActual()`, `shutdownActual()` |
| **Tool Manager** | `src/actualToolsManager.ts` | Tool registry and dispatch | `registerTools()`, `callTool()` |
| **MCP Connection** | `src/lib/ActualMCPConnection.ts` | MCP protocol implementation | `handleToolCall()`, `handleRequest()` |
| **Adapter Layer** | `src/lib/actual-adapter.ts` (+ leaf modules in `src/lib/actual-adapter/`) | `withActualApi` wrapper: retry, concurrency, pooled vs legacy execution (#134, split in #166) | All Actual API functions |
| **Connection Pool** | `src/lib/ActualConnectionPool.ts` | Per-session connections (up to `MAX_CONCURRENT_SESSIONS`, default 15), idle timeouts | `getConnection()`, `touch()`, `shutdownConnection()` |
| **Request Context** | `src/lib/requestContext.ts` | `AsyncLocalStorage` carrying the active session id (and principal) across async boundaries | `requestContext.run()` |
| **Singleton State** | `src/lib/apiState.ts` | Shared flag for the `@actual-app/api` singleton "live" state, probed by the adapter to decide pool reuse | `isApiInitialized()` |
| **Configuration** | `src/config.ts` | Environment validation | `config`, `configSchema` |
| **Logger** | `src/logger.ts` | Structured logging | `logger` singleton |
| **Observability** | `src/observability.ts` | Metrics collection | `incrementToolCall()`, `getMetricsText()` |

### Transport Implementations

| Transport | File | Status | Authentication | LibreChat Support |
|-----------|------|--------|----------------|-------------------|
| **HTTP** | `src/server/httpServer.ts` | ✅ Production | Bearer token OR OIDC/JWT | ✅ Fully supported |
| **WebSocket** | *(removed)* | ❌ Removed | N/A | ❌ Not supported |
| **SSE** | *(removed)* | ❌ Removed | N/A | N/A |

### Tool Definitions

71 tools organized by category:

```
src/tools/
├── server_info.ts                      # Server version / connection info
├── server_get_version.ts               # Actual Budget server version
├── get_id_by_name.ts                   # Exact name → UUID lookup (accounts/categories/payees/schedules)
├── entities_search.ts                  # Pattern/fuzzy name search for accounts/categories/payees (#204)
├── session_list.ts                     # Session management (2 tools)
├── session_close.ts
├── accounts_create.ts                  # Accounts (7 tools)
├── accounts_list.ts
├── accounts_update.ts
├── accounts_delete.ts
├── accounts_close.ts
├── accounts_reopen.ts
├── accounts_get_balance.ts
├── transactions_create.ts              # Transactions (13 tools)
├── transactions_get.ts
├── transactions_update.ts
├── transactions_delete.ts
├── transactions_import.ts
├── transactions_filter.ts
├── transactions_search_by_amount.ts
├── transactions_search_by_category.ts
├── transactions_search_by_month.ts
├── transactions_search_by_payee.ts
├── transactions_summary_by_category.ts
├── transactions_summary_by_payee.ts
├── transfers_create.ts                  # Transfers (1 tool)
├── budgets_list_available.ts            # Budgets (11 tools)
├── budgets_switch.ts
├── budgets_getMonth.ts
├── budgets_getMonths.ts
├── budgets_get_all.ts
├── budgets_setAmount.ts
├── budgets_transfer.ts
├── budgets_setCarryover.ts
├── budgets_holdForNextMonth.ts
├── budgets_resetHold.ts
├── budget_updates_batch.ts
├── categories_get.ts                   # Categories (4 tools)
├── categories_create.ts
├── categories_update.ts
├── categories_delete.ts
├── category_groups_get.ts              # Category Groups (4 tools)
├── category_groups_create.ts
├── category_groups_update.ts
├── category_groups_delete.ts
├── payees_get.ts                       # Payees (6 tools)
├── payees_common_list.ts
├── payees_create.ts
├── payees_update.ts
├── payees_delete.ts
├── payees_merge.ts
├── payee_rules_get.ts                  # Payee Rules (1 tool)
├── rules_get.ts                        # Rules (4 tools)
├── rules_create.ts
├── rules_update.ts
├── rules_delete.ts
├── tags_list.ts                        # Tags (4 tools)
├── tags_create.ts
├── tags_update.ts
├── tags_delete.ts
├── notes_get.ts                        # Notes (2 tools)
├── notes_update.ts
├── query_run.ts                        # Advanced ActualQL queries
├── bank_sync.ts                        # Bank synchronization
└── index.ts                            # Tool exports
```

---

## Data Flow

### Request Flow

```
1. Client sends MCP request
   │
   ├──> HTTP POST /http

   │
2. Transport layer receives request
   │
   └──> Parses JSON-RPC 2.0 format
   │
3. ActualMCPConnection routes request
   │
   ├──> tools/list → Returns available tools
   ├──> tools/call → Dispatches to ActualToolsManager
   └──> Other MCP methods
   │
4. ActualToolsManager validates and calls tool
   │
   ├──> Validates tool name exists
   ├──> Validates input schema (Zod)
   └──> Calls tool implementation function
   │
5. Tool calls Actual Adapter function
   │
   └──> Adapter applies retry logic & concurrency control
   │
6. @actual-app/api makes REST call
   │
   └──> Actual Budget Server processes request
   │
7. Response flows back up the stack
   │
   └──> JSON result or error returned to client
```

### Tool Call Example

```typescript
// Client request (MCP format)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "actual_transactions_create",
    "arguments": {
      "accountId": "uuid-123",
      "date": "2025-11-11",
      "amount": -5000,
      "payee": "Amazon"
    }
  }
}

// Server processing
ActualMCPConnection.handleToolCall()
  └─> ActualToolsManager.callTool("actual_transactions_create", args)
      └─> transactionsCreate(args) in src/tools/transactions_create.ts
          └─> actualAdapter.addTransaction(args) in src/lib/actual-adapter.ts
              └─> api.addTransaction(args) from @actual-app/api
                  └─> REST POST to Actual Budget Server

// Server response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "Transaction ID: uuid-456"
    }]
  }
}
```

---

## Module Structure

### Project Layout

```
actual-mcp-server/
├── src/                          # TypeScript source code
│   ├── index.ts                  # Main entry point
│   ├── config.ts                 # Environment validation (Zod)
│   ├── logger.ts                 # Winston logger singleton
│   ├── observability.ts          # Prometheus metrics
│   ├── actualConnection.ts       # Actual API connection manager
│   ├── actualToolsManager.ts     # Tool registry singleton
│   ├── utils.ts                  # Utility functions
│   ├── tests_adapter_runner.ts   # Adapter test executor
│   │
│   ├── lib/                      # Core libraries
│   │   ├── actual-adapter.ts     # withActualApi wrapper (retry, concurrency, pool cooperation)
│   │   ├── actual-adapter/       # Leaf modules: normalize, query, auth-retry, concurrency (#166)
│   │   ├── actual-schema.ts      # Actual DB schema for SQL validation
│   │   ├── ActualConnectionPool.ts # Per-session connection pool (default 15, idle timeouts)
│   │   ├── ActualMCPConnection.ts  # MCP protocol handler (EventEmitter-based)
│   │   ├── apiState.ts             # Shared @actual-app/api singleton live-state flag
│   │   ├── requestContext.ts       # AsyncLocalStorage carrying sessionId / principal
│   │   ├── budget-registry.ts      # Parses BUDGET_N_* env vars into budget configs
│   │   ├── budget-preference-store.ts # Per-principal preferred-budget store (#189)
│   │   ├── constants.ts            # Configuration constants and limits
│   │   ├── errors.ts               # notFoundMsg / constraintErrorMsg helpers
│   │   ├── loggerFactory.ts        # Module-scoped logger factory
│   │   ├── query-validator.ts      # ActualQL query validation
│   │   ├── retry.ts                # Exponential backoff retry logic
│   │   ├── toolFactory.ts          # createTool() factory helper
│   │   └── schemas/                # Per-domain Zod schemas (CommonSchemas)
│   │
│   ├── server/                   # Transport implementations
│   │   ├── httpServer.ts         # HTTP transport (Express, StreamableHTTP, auth)
│   │   └── stdioServer.ts        # stdio transport (Claude Desktop/Code)
│   │
│   ├── auth/                     # Authentication
│   │   ├── setup.ts              # OIDC/JWKS factory (AUTH_PROVIDER=oidc)
│   │   └── budget-acl.ts         # Per-user budget ACL (email/sub/group)
│   │
│   ├── tools/                    # MCP tool definitions (71 tools + index.ts)
│   │   ├── server_info.ts        # Server info (1 tool)
│   │   ├── session_*.ts          # Session management (2 tools)
│   │   ├── accounts_*.ts         # Accounts (7 tools)
│   │   ├── transactions_*.ts     # Transactions (13 tools, incl. search/summary)
│   │   ├── budgets_*.ts          # Budgets (11 tools)
│   │   ├── budget_updates_batch.ts # Batch budget operations
│   │   ├── categories_*.ts       # Categories (4 tools)
│   │   ├── category_groups_*.ts  # Category groups (4 tools)
│   │   ├── payees_*.ts           # Payees (6 tools)
│   │   ├── payee_rules_get.ts    # Payee rules (1 tool)
│   │   ├── rules_*.ts            # Rules (4 tools)
│   │   ├── tags_*.ts             # Tags (4 tools)
│   │   ├── notes_*.ts            # Notes (2 tools)
│   │   ├── query_run.ts          # Advanced ActualQL queries
│   │   ├── bank_sync.ts          # Bank synchronization
│   │   └── index.ts              # Tool exports
│   │
│   ├── types/                    # TypeScript type definitions
│   │   └── tool.d.ts             # MCP tool types
│   │
│   ├── prompts/                  # MCP prompt templates
│   │   └── showLargeTransactions.ts
│   │
│   └── resources/                # MCP resources
│       └── accountsSummary.ts
│
├── tests/                        # Tests
│   ├── e2e/                      # End-to-end tests (Playwright)
│   │   ├── mcp-client.playwright.spec.ts  # Protocol compliance tests
│   │   ├── docker.e2e.spec.ts             # Docker smoke tests
│   │   ├── docker-all-tools.e2e.spec.ts   # All-tools Docker E2E (~80 named tests, all 71 tools)
│   │   ├── run-docker-e2e.sh              # Docker test orchestrator
│   │   └── suites/                        # Domain suite registration functions (one file per domain)
│   │       ├── shared-context.ts          # SharedState / TestContext types
│   │       ├── server.ts / accounts.ts / categories.ts / payees.ts
│   │       ├── transactions.ts / budgets.ts / rules.ts / schedules.ts
│   │       └── advanced.ts / deletes.ts
│   ├── unit/                     # Unit tests (offline, stub adapter)
│   │   ├── transactions_create.test.js
│   │   ├── generated_tools.smoke.test.js
│   │   └── schema_validation.test.js
│   ├── shared/                   # Shared test utilities
│   │   ├── e2e-helpers.ts        # TS helpers for E2E: waitForMCPHealth, retryRequest, callTool, extractResult
│   │   └── mcp-protocol.js       # JS mirror of extractResult (used by manual integration suite)
│   └── manual/                   # Live integration tests (real Actual Budget)
│
├── scripts/                      # Build and utility scripts (see scripts/README.md)
│   ├── verify-tools.js           # Tool coverage verification
│   ├── bootstrap-and-init.sh     # Docker: bootstrap Actual server + import test budget
│   ├── import-test-budget.sh     # Upload test-data/*.zip to Actual server
│   ├── register-tsconfig-paths.js # Path alias resolver for dist/ runtime
│   ├── list-actual-api-methods.mjs # API method coverage checker
│   └── version-bump.js / version-check.js / version-dev.js  # Versioning
│
├── docs/                         # Documentation (this folder)
├── generated/                    # Generated TypeScript types
├── actual-data/                  # Budget data cache (gitignored)
├── logs/                         # Application logs (gitignored)
│
├── Dockerfile                    # Production container
├── docker-compose.yaml           # Docker Compose (dev/production profiles)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
└── .env.example                  # Environment variable template
```

---

## Execution Lifecycle

### Startup Sequence

```
1. CLI Argument Parsing
   └─┾ src/index.ts parses --help, --debug, --http
   └─> --help exits early (before loading environment)

2. Environment Loading
   └─> dotenv loads .env file
   └─> src/config.ts validates with Zod schema
   └─> Exits with error if validation fails

3. Dynamic Imports
   └─> Lazy load all dependencies (winston, @actual-app/api, etc.)
   └─> Improves cold start performance

4. Actual Budget Connection
   └─> src/actualConnection.ts::connectToActual()
   └─> api.init({ dataDir, serverURL, password })
   └─> api.downloadBudget(syncId, { password })
   └─> Budget data cached to MCP_BRIDGE_DATA_DIR

5. Tool Registry Initialization
   └─> src/actualToolsManager.ts loads all tools
   └─> Validates tool schemas
   └─> Registers 71 tools with MCP capabilities

6. MCP Connection Setup
   └─> Create ActualMCPConnection instance
   └─> Build capabilities object (tools, resources, prompts)

7. Transport Server Startup
   └─┾ Start HTTP server
   └─> Bind to MCP_BRIDGE_PORT
   └─> Register health endpoints

8. Ready State
   └─> Log current server version and transport mode
   └─> Accept MCP requests
```

### Shutdown Sequence

```
1. SIGINT / SIGTERM received
   │
2. Graceful shutdown initiated
   ├─┾ Close transport server (HTTP)
   ├─> Stop accepting new requests
   ├─> Wait for pending requests (timeout: 10s)
   │
3. Actual Budget disconnection
   └─> src/actualConnection.ts::shutdownActual()
   └─> api.shutdown() - closes DB connections
   │
4. Logger flush
   └─> Winston flushes remaining log entries
   │
5. Process exit
   └─> Exit code 0 (clean shutdown)
```

### Test Modes

The server supports special test modes:

```bash
# Test Actual Budget connection only
npm run dev -- --test-actual-connection
  └─> Connects, downloads budget, disconnects, exits

# Test MCP client interaction
npm run dev -- --http --test-mcp-client
  └─> Starts server, sends test requests, verifies responses
```

---

## Configuration

### Environment Variables

All configuration via environment variables. The canonical inventory of every
variable (type, default, source, read site) is [docs/CONFIGURATION.md](CONFIGURATION.md);
`.env.example` carries the same set with inline comments. A variable is canonical if it
is a Zod schema key in `src/config.ts` OR an entry in `RAW_ENV_ALLOWLIST` in
`src/lib/config-registry.ts`. The drift guard `scripts/config-drift.mjs` (run in CI via
`tests/unit/config_drift.test.js`) fails the build if the schema/allowlist,
`.env.example`, and the README env table disagree.

#### Required Variables

```bash
# Actual Budget connection
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your_sync_id
```

#### Server Configuration

```bash
# Server settings
MCP_BRIDGE_PORT=3600                    # Server port
MCP_BRIDGE_DATA_DIR=./actual-data       # Budget cache directory
MCP_BRIDGE_BIND_HOST=0.0.0.0            # Bind address

# Transport mode (Docker only)
MCP_TRANSPORT_MODE=--http               # Only --http is supported
```

#### Security

```bash
# Authentication mode (default: none = static Bearer)
AUTH_PROVIDER=none                       # 'none' or 'oidc'

# Static Bearer token (AUTH_PROVIDER=none)
MCP_SSE_AUTHORIZATION=your_bearer_token  # Bearer token (optional)

# OIDC / JWT authentication (AUTH_PROVIDER=oidc)
OIDC_ISSUER=https://sso.yourdomain.com   # OIDC issuer URL
OIDC_RESOURCE=your-client-id             # Expected 'aud' claim
OIDC_ACCEPTED_AUDIENCES=                 # Extra accepted 'aud' values (#245, optional)
OIDC_JWKS_TRUSTED_HOSTS=                 # Cross-host JWKS allowlist, e.g. Google (#254, optional)
OIDC_ALLOW_INSECURE_ISSUER=false         # #244 opt-out for a trusted-LAN http issuer
OIDC_SCOPES=                             # Required scopes (empty = none)
AUTH_BUDGET_ACL=user@example.com:sync-id # Per-user budget ACL (optional)

# HTTPS
MCP_ENABLE_HTTPS=true                    # Enable TLS
MCP_HTTPS_CERT=/app/certs/cert.pem       # Certificate path
MCP_HTTPS_KEY=/app/certs/key.pem         # Private key path
```

#### Logging

```bash
# Log configuration
MCP_BRIDGE_STORE_LOGS=false              # Write to disk
MCP_BRIDGE_LOG_DIR=./logs                # Log directory
MCP_BRIDGE_LOG_LEVEL=info                # error, warn, info, debug
```

#### Testing

```bash
# Test flags
SKIP_BUDGET_DOWNLOAD=false               # Skip budget sync on startup
DEBUG=true                                # Enable debug logging
```

### Configuration Schema

Validated by a Zod schema in `src/config.ts`. The snippet below is illustrative, not exhaustive: `.env.example` and `src/config.ts` are authoritative. Notably, multi-budget mode adds `BUDGET_N_NAME`, `BUDGET_N_SYNC_ID`, `BUDGET_N_SERVER_URL`, `BUDGET_N_PASSWORD`, and `BUDGET_N_ENCRYPTION_PASSWORD` (N = 1, 2, 3...), and concurrency is tunable via `ACTUAL_API_CONCURRENCY`.

```typescript
export const configSchema = z.object({
  ACTUAL_SERVER_URL: z.string().url(),
  ACTUAL_PASSWORD: z.string().min(1),
  ACTUAL_BUDGET_SYNC_ID: z.string().min(1),
  MCP_BRIDGE_DATA_DIR: z.string().default('./actual-data'),
  MCP_BRIDGE_PORT: z.string().default('3600'),
  MCP_TRANSPORT_MODE: z.enum(['--http']).default('--http'),
  MCP_SSE_AUTHORIZATION: z.string().optional(),
  AUTH_PROVIDER: z.enum(['none', 'oidc']).default('none'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_RESOURCE: z.string().optional(),
  OIDC_SCOPES: z.string().optional(),
  AUTH_BUDGET_ACL: z.string().optional(),
  MCP_ENABLE_HTTPS: z.string().optional().transform(val => val === 'true'),
  MCP_HTTPS_CERT: z.string().optional(),
  MCP_HTTPS_KEY: z.string().optional(),
});
```

---

## Transport Protocols

### HTTP Transport (Recommended)

**Type**: `streamable-http` from `@modelcontextprotocol/sdk`

**Endpoints**:
- `POST /http` - MCP requests
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

**Authentication**: Bearer token OR OIDC/JWT in `Authorization` header

**LibreChat Status**: ✅ Fully supported and verified

**Configuration**:
```bash
# Start HTTP server
npm run dev -- --http

# Docker (default)
docker run -e MCP_TRANSPORT_MODE=--http ...
```

**LibreChat Config**:
```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "https://your-server:3600/http"
    headers:
      Authorization: "Bearer your_token"
    serverInstructions: true
```

> ⚠️ **Removed**: WebSocket transport (`wsServer.ts`) has been removed. Use HTTP transport instead.

> ⚠️ **Removed**: SSE transport (`sseServer.ts`) has been removed. Use HTTP transport instead.

---

## Error Handling

### Error Flow

```
Tool Error
  └─> Caught by tool implementation
      └─> Adapter layer retry logic (3 attempts)
          └─> If all retries fail → Error response
              └─> ActualMCPConnection formats error
                  └─> Transport sends JSON-RPC error

Error Response Format:
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "Tool execution failed: ..."
  }
}
```

### Retry Logic

Implemented in `src/lib/actual-adapter.ts`:

```typescript
// Exponential backoff retry (src/lib/constants.ts)
DEFAULT_RETRY_ATTEMPTS = 3
DEFAULT_RETRY_BACKOFF_MS = 200   // 200ms base delay
MAX_RETRY_DELAY_MS = 10000       // cap at 10s
// backoff sequence: 200ms → 400ms → 800ms (capped at 10s)
```

### Concurrency Control

```typescript
// Prevent overwhelming Actual Budget server (src/lib/constants.ts)
DEFAULT_CONCURRENCY_LIMIT = 5   // max simultaneous API calls
// Overflow requests are queued and drained FIFO
// Configurable via ACTUAL_API_CONCURRENCY env var
```

---

## Performance & Reliability

### Optimization Strategies

1. **Per-session connection pool**: `ActualConnectionPool` holds one connection per MCP session (up to `MAX_CONCURRENT_SESSIONS`, default 15), with idle timeouts. While a session is active the `withActualApi` wrapper runs operations against the existing connection instead of re-running `api.init()` / `api.shutdown()` per call (pooled mode, #134), which removed the per-op upstream-login burst. Non-MCP callers fall back to the legacy init-to-shutdown cycle.
2. **Local Caching**: Budget data cached to SQLite (MCP_BRIDGE_DATA_DIR)
3. **Lazy Loading**: Dynamic imports for faster cold starts
4. **Retry Logic**: Automatic recovery from transient failures (the pool entry is dropped only on infrastructure errors, not on user/domain errors)

### Monitoring

- **Health Endpoint**: `/health` returns `{"status":"ok","initialized":true}`
- **Metrics Endpoint**: `/metrics` exposes Prometheus metrics
- **Structured Logging**: Winston with daily rotation

### Reliability Features

- **Graceful Shutdown**: SIGTERM/SIGINT handlers
- **Error Boundaries**: All tool calls wrapped in try/catch
- **Input Validation**: Zod schemas for all tool inputs
- **Type Safety**: Full TypeScript with strict mode

### Session Liveness Ownership (#167)

`ActualConnectionPool` is the single source of truth for session liveness and idle timing. There is one idle timer and one `SESSION_IDLE_TIMEOUT_MINUTES` value for the whole process, consumed only by the pool.

- **Ownership split**: the pool owns the `connections` map, per-session `lastActivity`, the idle sweep timer, and the idle threshold. `httpServer` owns only the `transports` map (one StreamableHTTP transport object per session) plus `sessionInitPromises` (transport-init coordination).
- **Per-request activity**: on every request `httpServer` calls `connectionPool.touch(sessionId)` so the pool's idle clock reflects real usage. Liveness for serving is decided purely by transport presence: the eviction listener (below) removes the transport the moment a session is genuinely evicted, so a missing transport means expired. `httpServer` deliberately does NOT additionally gate on `connectionPool.isLive()`, because a pool entry can be legitimately absent while the MCP session is still usable (after a transient infra error the adapter drops the pool entry without evicting the transport, and the next call re-establishes it through the legacy fallback). `isLive()` remains a pool query method for diagnostics.
- **Eager teardown via eviction callback**: when the pool removes a session (idle sweep or explicit `session_close` / server shutdown) it fires a registered eviction listener. `httpServer` registers one that closes the transport and deletes its `transports` / `sessionInitPromises` entries, so both tables change in the same window. The mechanism is callback-based eager teardown, not lazy query-on-demand: a lazily-cleaned table would leak transport objects for sessions a client abandons without reconnecting.
- **Paths that do NOT evict**: `switchBudget`'s slow path and infra-error drops call `connectionPool.shutdownConnection(sessionId)` without `{ evict: true }`, so the MCP session's transport survives a budget switch or a transient network error while the pool entry is recycled.
- **Behavior change**: the effective idle window is now exactly the single configured value, not `min(httpServer, pool)`. Before this consolidation the httpServer table defaulted to 2 minutes and the pool to 5, so the two clocks could disagree and a session could be alive in one table and dead in the other.

---

## Technology Stack & Dependencies

The dependency list lives in `package.json` (the source of truth) and is summarised in CLAUDE.md's "Tech Stack" line, so it is not duplicated here. A hand-maintained copy drifts: run `npm ls --depth=0` for the installed tree and `npm audit` for the current security posture.

Highlights: TypeScript (NodeNext/ESM) on Node 22+, `@actual-app/api` v26, `@modelcontextprotocol/sdk`, Express 5, Zod v4, Winston for logging, and Playwright for E2E. Dependency updates are automated (Dependabot weekly plus the scheduled Dependency Update workflow): patches auto-merge after CI, minor and major bumps get review.

---

## Next Steps

For more details:
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Testing strategy
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security policies
- Planned and future work: tracked as [GitHub issues](https://github.com/agigante80/actual-mcp-server/issues)
