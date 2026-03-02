# Architecture

**Project:** Actual MCP Server  
**Version:** 0.4.9  
**Last Updated:** 2026-03-02

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
- [Performance & Reliability](#performance--reliability)

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
                   HTTP / WebSocket / SSE
                            ▼
┌───────────────────────────────────────────────────────────┐
│               Transport Layer                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │   HTTP   │  │   WSS    │  │   SSE    │               │
│  │ Server   │  │  Server  │  │  Server  │               │
│  └──────────┘  └──────────┘  └──────────┘               │
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
│  │Tool1│  │Tool2│  │Tool3│  │ ... │  │ 51  │           │
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
| **Adapter Layer** | `src/lib/actual-adapter.ts` | API wrapper with error handling | All Actual API functions |
| **Configuration** | `src/config.ts` | Environment validation | `config`, `configSchema` |
| **Logger** | `src/logger.ts` | Structured logging | `logger` singleton |
| **Observability** | `src/observability.ts` | Metrics collection | `incrementToolCall()`, `getMetricsText()` |

### Transport Implementations

| Transport | File | Status | Authentication | LibreChat Support |
|-----------|------|--------|----------------|-------------------|
| **HTTP** | `src/server/httpServer.ts` | ✅ Production | Bearer token | ✅ Fully supported |
| **SSE** | `src/server/sseServer.ts` | ✅ Production | Bearer token* | ⚠️ Headers not sent |
| **WebSocket** | *(removed)* | ❌ Removed | N/A | ❌ Not supported |

*SSE authentication works server-side but LibreChat client doesn't send custom headers

### Tool Definitions

51 tools organized by category:

```
src/tools/
├── server_info.ts                      # Server version / connection info
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
├── budgets_getMonth.ts                 # Budgets (9 tools)
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
├── payees_get.ts                       # Payees (5 tools)
├── payees_create.ts
├── payees_update.ts
├── payees_delete.ts
├── payees_merge.ts
├── payee_rules_get.ts                  # Payee Rules (1 tool)
├── rules_get.ts                        # Rules (4 tools)
├── rules_create.ts
├── rules_update.ts
├── rules_delete.ts
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
   └──> SSE connection + POST
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
│   │   ├── actual-adapter.ts     # Actual API wrapper (withActualApi, callWithRetry)
│   │   ├── actual-schema.ts      # Shared Zod schema definitions
│   │   ├── ActualConnectionPool.ts # Connection pool management
│   │   ├── ActualMCPConnection.ts  # MCP protocol handler (EventEmitter-based)
│   │   ├── ActualMCPConnection.js  # Compiled JS companion
│   │   ├── constants.ts            # Configuration constants and limits
│   │   ├── loggerFactory.ts        # Module-scoped logger factory
│   │   ├── query-validator.ts      # ActualQL query validation
│   │   ├── retry.ts                # Exponential backoff retry logic
│   │   ├── toolFactory.ts          # Tool definition factory helpers
│   │   └── schemas/                # Per-domain Zod schemas
│   │
│   ├── server/                   # Transport implementations
│   │   ├── httpServer.ts         # HTTP transport (recommended)
│   │   ├── httpServer_testing.ts # HTTP server for test environments
│   │   ├── sseServer.ts          # Server-Sent Events transport
│   │   ├── streamable-http.ts    # Streamable HTTP protocol implementation
│   │   ├── streamable-http.js    # Compiled JS companion
│   │   └── streamable-http.d.ts  # Type definitions
│   │
│   ├── tools/                    # MCP tool definitions (51 tools + index.ts)
│   │   ├── server_info.ts        # Server info (1 tool)
│   │   ├── session_*.ts          # Session management (2 tools)
│   │   ├── accounts_*.ts         # Accounts (7 tools)
│   │   ├── transactions_*.ts     # Transactions (13 tools, incl. search/summary)
│   │   ├── budgets_*.ts          # Budgets (9 tools)
│   │   ├── budget_updates_batch.ts # Batch budget operations
│   │   ├── categories_*.ts       # Categories (4 tools)
│   │   ├── category_groups_*.ts  # Category groups (4 tools)
│   │   ├── payees_*.ts           # Payees (5 tools)
│   │   ├── payee_rules_get.ts    # Payee rules (1 tool)
│   │   ├── rules_*.ts            # Rules (4 tools)
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
│   │   ├── docker-all-tools.e2e.spec.ts   # All-tools Docker E2E (51 tools)
│   │   └── run-docker-e2e.sh              # Docker test orchestrator
│   ├── unit/                     # Unit tests (offline, stub adapter)
│   │   ├── transactions_create.test.js
│   │   ├── generated_tools.smoke.test.js
│   │   └── schema_validation.test.js
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
   └─> src/index.ts parses --help, --debug, --sse, --http
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
   └─> Registers 51 tools with MCP capabilities

6. MCP Connection Setup
   └─> Create ActualMCPConnection instance
   └─> Build capabilities object (tools, resources, prompts)

7. Transport Server Startup
   └─> Start HTTP / SSE / WebSocket server
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
   ├─> Close transport server (HTTP/SSE/WS)
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

# Test all tool implementations
npm run dev -- --test-actual-tools
  └─> Runs smoke tests for all 51 tools

# Test MCP client interaction
npm run dev -- --http --test-mcp-client
  └─> Starts server, sends test requests, verifies responses
```

---

## Configuration

### Environment Variables

All configuration via environment variables. See `.env.example` for complete reference.

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
MCP_TRANSPORT_MODE=--http               # --http or --sse
```

#### Security

```bash
# Authentication
MCP_SSE_AUTHORIZATION=your_bearer_token  # Bearer token (optional)

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

Validated by Zod schema in `src/config.ts`:

```typescript
export const configSchema = z.object({
  ACTUAL_SERVER_URL: z.string().url(),
  ACTUAL_PASSWORD: z.string().min(1),
  ACTUAL_BUDGET_SYNC_ID: z.string().min(1),
  MCP_BRIDGE_DATA_DIR: z.string().default('./actual-data'),
  MCP_BRIDGE_PORT: z.string().default('3000'),
  MCP_TRANSPORT_MODE: z.enum(['--http', '--sse']).default('--http'),
  MCP_SSE_AUTHORIZATION: z.string().optional(),
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

**Authentication**: Bearer token in `Authorization` header

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

### SSE Transport

**Type**: Server-Sent Events

**Endpoints**:
- `GET /sse` - Event stream
- `POST /sse` - Send messages

**Authentication**: Bearer token (server-side only)

**LibreChat Status**: ⚠️ Client doesn't send auth headers

**Use Case**: Development without authentication

### WebSocket Transport

> ⚠️ **Removed**: WebSocket transport (`wsServer.ts`) has been removed from the codebase. Use HTTP transport instead.

**LibreChat Status**: ❌ Not supported

**Migration**: Replace `--ws` flag with `--http` flag. Update any custom MCP clients to use HTTP POST to `/http`.

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

1. **Connection Pooling**: Single persistent connection to Actual Budget
2. **Local Caching**: Budget data cached to SQLite (MCP_BRIDGE_DATA_DIR)
3. **Lazy Loading**: Dynamic imports for faster cold starts
4. **Retry Logic**: Automatic recovery from transient failures

### Monitoring

- **Health Endpoint**: `/health` returns `{"status":"ok","initialized":true}`
- **Metrics Endpoint**: `/metrics` exposes Prometheus metrics
- **Structured Logging**: Winston with daily rotation

### Reliability Features

- **Graceful Shutdown**: SIGTERM/SIGINT handlers
- **Error Boundaries**: All tool calls wrapped in try/catch
- **Input Validation**: Zod schemas for all tool inputs
- **Type Safety**: Full TypeScript with strict mode

---

## Technology Stack & Dependencies

### Core Dependencies

**Production Runtime:**
- **@actual-app/api** (^26.2.1): Official Actual Budget API client
  - Purpose: Core integration with Actual Budget server
  - License: MIT
  - Status: ✅ Current, actively maintained

- **@modelcontextprotocol/sdk** (^1.18.2): Model Context Protocol SDK
  - Purpose: MCP protocol implementation
  - License: MIT
  - Status: 🔄 Update available (1.22.0)
  - Action: Scheduled for minor update

- **express** (^4.21.2): Web server framework
  - Purpose: HTTP/SSE transport layer
  - License: MIT
  - Status: ✅ Current (Express v5 available but deferred)
  - Note: Major v5 migration planned for Q1 2026

- **winston** (^3.18.3): Logging framework
  - Purpose: Structured logging with daily rotation
  - License: MIT
  - Status: ✅ Current

- **axios** (^1.12.2): HTTP client
  - Purpose: External API calls
  - License: MIT
  - Status: 🔄 Update available (1.13.2)

**Development Tools:**
- **TypeScript** (^5.9.2): Type-safe development
- **@playwright/test** (^1.56.0): E2E testing framework
- **ts-node** (^10.9.1): TypeScript execution

### Dependency Management

**Automated Monitoring:**
- **Dependabot**: Weekly security scans, auto-PRs for updates
- **Renovate Bot**: Intelligent update grouping, auto-merge for low-risk patches
- **CI/CD**: Automated testing on dependency changes

**Security Posture:**
- ✅ No known critical/high vulnerabilities (run `npm audit` for current status)
- ✅ All packages actively maintained
- ✅ Permissive licenses only (MIT, Apache-2.0, ISC, BSD)

**Update Strategy:**
- **Patch updates** (x.x.X): Auto-merge weekly after CI passes
- **Minor updates** (x.X.x): Manual review for production deps
- **Major updates** (X.x.x): Dedicated migration sprint with breaking change analysis

**Monitoring:**
- Daily automated dependency checks (1 AM UTC)
- Automated security vulnerability alerts (Dependabot)
- Automated dependency update PRs with auto-merge
- See `.github/workflows/dependency-update.yml` for automation details

> ⚠️ **Zod version**: Zod is pinned to `3.x` via `package.json` overrides. Do NOT upgrade to Zod 4.x — it breaks `zod-to-json-schema` compatibility and makes all tools invisible to LibreChat.

### Third-Party Integrations

**Actual Budget Server:**
- REST API integration via @actual-app/api
- Local SQLite cache for performance
- Automatic sync on startup

**LibreChat / MCP Clients:**
- HTTP transport (recommended, default)
- Server-Sent Events (SSE) for streaming
- WebSocket: removed (use HTTP instead)

**Monitoring & Observability:**
- Prometheus metrics (`/metrics` endpoint)
- Winston structured logging
- Health checks (`/health` endpoint)

---

## Next Steps

For more details:
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Testing strategy
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security policies
- [Roadmap](./ROADMAP.md) - Future improvements
- [AI Interaction Guide](./AI_INTERACTION_GUIDE.md) - AI agent rules
