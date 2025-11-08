# Project Deep Analysis & AI Interaction Guide

**Generated:** 2025-11-08  
**Project:** Actual MCP Server  
**Version:** 0.1.0  
**Purpose:** MCP (Model Context Protocol) bridge connecting LibreChat to Actual Finance API

---

## 1. Project Overview

### 1.1 Purpose & Goals

The **Actual MCP Server** is a bridge service that exposes Actual Finance budgeting application APIs through the Model Context Protocol (MCP). This enables AI assistants (primarily LibreChat) to interact with personal finance data, perform budget operations, manage transactions, and provide financial insights through natural language conversations.

**Core Value Proposition:**
- Allows AI assistants to manage personal finances via conversational interface
- Provides standardized MCP tools for budget operations
- Supports multiple transport protocols (HTTP, WebSocket, SSE)
- Enables automated financial workflows through AI agents

**Current Status:** Work in progress - core functionality implemented but expanding coverage

### 1.2 Technology Stack

**Runtime & Language:**
- **Node.js 20+** (Alpine Linux in Docker)
- **TypeScript 5.9.2** with ES2020 target and NodeNext module resolution
- **ESM modules** throughout (type: "module" in package.json)

**Core Dependencies:**
- `@actual-app/api` (^25.9.0) - Official Actual Finance API client
- `@modelcontextprotocol/sdk` (^1.18.2) - MCP protocol implementation
- `express` (^4.21.2) - HTTP server framework
- `ws` (^8.18.3) - WebSocket server support
- `winston` (^3.18.3) - Structured logging with rotation
- `zod` - Runtime type validation and schema generation
- `date-fns` (^4.1.0) - Date manipulation

**Development Tools:**
- `@playwright/test` (^1.56.0) - End-to-end testing
- `openapi-typescript` - Type generation from OpenAPI specs
- `ts-node` - TypeScript execution for scripts
- `nodemon` - Development hot-reload

**Infrastructure:**
- Docker with multi-stage builds
- Docker Compose for local testing
- SQLite backend (via Actual Budget)

### 1.3 Main Modules & Entry Points

**Primary Entry Point:**
- `src/index.ts` - Main application orchestrator
  - Command-line argument parsing
  - Environment configuration loading
  - Server mode selection (HTTP/WS/SSE)
  - Tool manager initialization
  - Connection setup

**Core Modules:**

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `src/actualConnection.ts` | Actual Finance API connection manager | `connectToActual()`, `shutdownActual()`, `getConnectionState()` |
| `src/actualToolsManager.ts` | MCP tool registry and dispatcher | `ActualToolsManager` class singleton |
| `src/lib/actual-adapter.ts` | API wrapper with retry/concurrency | All Actual API functions with error handling |
| `src/lib/ActualMCPConnection.ts` | MCP protocol implementation | `ActualMCPConnection` class |
| `src/config.ts` | Environment validation | `config` object, `configSchema` |
| `src/logger.ts` | Structured logging | `logger` singleton |
| `src/observability.ts` | Metrics collection (Prometheus) | `incrementToolCall()`, `getMetricsText()` |

**Server Implementations:**
- `src/server/httpServer.ts` - HTTP/REST MCP transport
- `src/server/sseServer.ts` - Server-Sent Events transport
- `src/server/wsServer.ts` - WebSocket transport
- `src/server/httpServer_testing.ts` - Mock server for development

**Tool Definitions:**
- `src/tools/*.ts` - Individual MCP tool implementations
- `src/tools/index.ts` - Tool export aggregator

### 1.4 Execution Flow

**Startup Sequence:**

```
1. index.ts: Parse CLI args (--help exits early, before dotenv)
2. index.ts: Load dotenv configuration
3. index.ts: Set debug flags if --debug specified
4. index.ts: Dynamic imports of all dependencies
5. actualConnection.ts: Connect to Actual Finance API
   - Initialize API with server URL, password, data directory
   - Download budget data (unless SKIP_BUDGET_DOWNLOAD=true)
   - Handle test modes (--test-actual-connection, --test-actual-tools)
6. actualToolsManager.ts: Initialize tool registry
   - Load all tools from src/tools/index.ts
   - Register each tool with name and schema
7. index.ts: Build MCP capabilities object
8. index.ts: Create ActualMCPConnection instance
9. index.ts: Determine advertised URL (host, port, path)
10. index.ts: Start selected server (HTTP/WS/SSE)
11. Server: Listen for MCP client connections
```

**Request Handling Flow:**

```
Client Request → Server Transport → ActualMCPConnection
                                           ↓
                                   actualToolsManager.callTool()
                                           ↓
                                   Tool validation (Zod schema)
                                           ↓
                                   actual-adapter function
                                           ↓
                                   Concurrency limiter
                                           ↓
                                   Retry wrapper
                                           ↓
                                   @actual-app/api raw method
                                           ↓
                                   Response normalization
                                           ↓
                                   Observability tracking
                                           ↓
                                   Return to client
```

### 1.5 Key Design Patterns

1. **Singleton Pattern**: `actualToolsManager`, `logger`, `config`, `observability`
2. **Adapter Pattern**: `actual-adapter.ts` wraps raw API with retry/concurrency
3. **Strategy Pattern**: Multiple server transports (HTTP/WS/SSE)
4. **Factory Pattern**: Tool registration and instantiation
5. **Decorator Pattern**: Retry and concurrency wrappers around API calls
6. **Observer Pattern**: EventEmitter for progress notifications

---

## 2. Architecture & Structure

### 2.1 Folder Structure & Responsibilities

```
actual-mcp-server/
├── src/                          # Main source code
│   ├── index.ts                  # Application entry point & orchestrator
│   ├── config.ts                 # Environment validation (Zod schemas)
│   ├── logger.ts                 # Winston logging with rotation
│   ├── actualConnection.ts       # Actual Finance connection manager
│   ├── actualToolsManager.ts     # MCP tool registry
│   ├── observability.ts          # Prometheus metrics (optional)
│   ├── utils.ts                  # Helper functions (getLocalIp, etc.)
│   ├── tests_adapter_runner.ts   # Adapter test execution
│   │
│   ├── lib/                      # Core library code
│   │   ├── actual-adapter.ts     # API wrapper with retry/concurrency
│   │   ├── ActualMCPConnection.ts # MCP protocol implementation
│   │   └── retry.ts              # Exponential backoff retry logic
│   │
│   ├── server/                   # Server transport implementations
│   │   ├── httpServer.ts         # HTTP REST transport
│   │   ├── sseServer.ts          # Server-Sent Events transport
│   │   ├── wsServer.ts           # WebSocket transport
│   │   ├── httpServer_testing.ts # Mock server for development
│   │   └── streamable-http.ts    # MCP HTTP streaming helpers
│   │
│   ├── tools/                    # MCP tool definitions
│   │   ├── index.ts              # Tool exports aggregator
│   │   ├── accounts_*.ts         # Account management tools
│   │   ├── transactions_*.ts     # Transaction tools
│   │   ├── budgets_*.ts          # Budget tools
│   │   ├── categories_*.ts       # Category tools
│   │   └── payees_*.ts           # Payee tools
│   │
│   ├── prompts/                  # MCP prompt templates (planned)
│   ├── resources/                # MCP resource definitions (planned)
│   └── types/                    # TypeScript type definitions
│
├── test/                         # Test suite
│   ├── e2e/                      # End-to-end Playwright tests
│   ├── integration/              # Integration tests (LibreChat, Docker)
│   ├── unit/                     # Unit tests
│   └── docker-actual-test/       # Docker-based test infrastructure
│
├── scripts/                      # Build and generation scripts
│   ├── generate-tools.ts         # Auto-generate tools from OpenAPI
│   ├── generate-tools-node.js    # Node.js wrapper for generation
│   ├── verify-tools.js           # Tool validation script
│   └── openapi/                  # OpenAPI specs
│
├── generated/                    # Auto-generated code
│   └── actual-client/            # TypeScript types from OpenAPI
│
├── types/                        # Custom type definitions
│   ├── tool.d.ts                 # Tool interface definition
│   ├── actual-api.d.ts           # Actual API type augmentations
│   └── *.d.ts                    # Other type declarations
│
├── actual-data/                  # Actual Finance data directory (runtime)
├── app/logs/                     # Application logs (if enabled)
├── docs/                         # Documentation
├── Dockerfile                    # Docker image definition
├── docker-compose.prod.yml       # Production deployment config
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Dependencies and scripts
└── .env.example                  # Environment variable template
```

### 2.2 Key Classes & Functions

#### Core Classes

**`ActualToolsManager` (src/actualToolsManager.ts)**
```typescript
class ActualToolsManager {
  private tools: Map<string, ToolDefinition>
  
  async initialize()                          // Load all tools from src/tools
  getToolNames(): string[]                    // List registered tool names
  getTool(name: string): ToolDefinition       // Get tool definition
  async callTool(name: string, args: unknown) // Execute tool with validation
}
```

**`ActualMCPConnection` (src/lib/ActualMCPConnection.ts)**
```typescript
class ActualMCPConnection extends EventEmitter {
  name: string
  capabilities: object
  
  async fetchCapabilities()                   // Return MCP server capabilities
  async executeTool(toolName, params)         // Execute tool by name
  close()                                     // Cleanup and shutdown
}
```

#### Core Functions

**Connection Management:**
- `connectToActual()` - Initialize Actual API, download budget
- `shutdownActual()` - Clean shutdown of Actual API
- `getConnectionState()` - Check initialization status

**Adapter Functions (all in actual-adapter.ts):**
- `getAccounts()` - List all accounts
- `addTransactions()` - Create new transactions
- `importTransactions()` - Import/reconcile transactions
- `getTransactions()` - Query transactions by date range
- `getCategories()` - List budget categories
- `createCategory()` - Create new category
- `getPayees()` - List payees
- `createPayee()` - Create new payee
- `getBudgetMonths()` - List available budget months
- `getBudgetMonth()` - Get specific month budget data
- `setBudgetAmount()` - Set budget amount for category
- `createAccount()` - Create new account
- `updateAccount()` - Update account properties
- `getAccountBalance()` - Get account balance at date

**Utility Functions:**
- `retry()` - Exponential backoff retry wrapper
- `withConcurrency()` - Concurrency limiter queue
- `normalizeToTransactionArray()` - Normalize API responses
- `normalizeToId()` - Extract ID from various response formats
- `getLocalIp()` - Detect LAN IP for server advertising

### 2.3 Data Models

**ToolDefinition Interface:**
```typescript
interface ToolDefinition {
  name: string                    // Tool identifier (e.g., "actual.accounts.list")
  description: string             // Human-readable description
  inputSchema: ZodTypeAny         // Zod schema for validation
  call: (args: unknown, meta?: unknown) => Promise<unknown>
}
```

**Config Schema (Zod):**
```typescript
{
  ACTUAL_SERVER_URL: string (URL)
  ACTUAL_PASSWORD: string
  ACTUAL_BUDGET_SYNC_ID: string
  MCP_BRIDGE_DATA_DIR: string (default: './actual-data')
  MCP_BRIDGE_PORT: string (default: '3000')
}
```

**Generated Types:**
- `components['schemas']['Account']` - Account object
- `components['schemas']['Transaction']` - Transaction object
- `components['schemas']['TransactionInput']` - Transaction creation input
- `components['schemas']['Category']` - Category object
- `components['schemas']['Payee']` - Payee object
- `components['schemas']['BudgetMonth']` - Monthly budget data
- `components['schemas']['BudgetSetRequest']` - Budget amount update

### 2.4 APIs & External Interfaces

**MCP Protocol Endpoints:**

*HTTP Transport (default: `/http`):*
```
GET  /.well-known/oauth-protected-resource  # MCP discovery
POST /http                                   # JSON-RPC endpoint
  Methods:
    - initialize                             # Client handshake
    - tools/list                             # List available tools
    - tools/call                             # Execute a tool
    - ping                                   # Health check
```

*WebSocket Transport (default: `/`):*
```
WS /                                         # WebSocket connection
  Messages:
    - { method: "initialize", ... }
    - { method: "tools/list", ... }
    - { method: "tools/call", ... }
```

*SSE Transport (default: `/sse`):*
```
GET /sse                                     # Server-Sent Events stream
  Events:
    - server/capabilities
    - server/instructions
    - ping (every 15s)
```

**CLI Interface:**
```bash
node dist/src/index.js [OPTIONS]

OPTIONS:
  --http                     # Start HTTP MCP server
  --ws                       # Start WebSocket MCP server
  --sse                      # Start SSE MCP server
  --http-testing             # Start mock HTTP server
  --test-actual-connection   # Test Actual connection and exit
  --test-actual-tools        # Test all tools and exit
  --test-mcp-client          # Run client-side MCP tests
  --debug                    # Enable verbose logging
  --help                     # Show help message
```

### 2.5 Environment Variables

**Required:**
- `ACTUAL_SERVER_URL` - Actual Finance server URL (e.g., `http://localhost:5006`)
- `ACTUAL_PASSWORD` - Actual Finance password
- `ACTUAL_BUDGET_SYNC_ID` - Budget sync identifier

**Optional - Server Configuration:**
- `MCP_BRIDGE_DATA_DIR` - Data directory (default: `./actual-data`)
- `MCP_BRIDGE_PORT` - Server port (default: `3600`)
- `MCP_BRIDGE_BIND_HOST` - Bind interface (default: `0.0.0.0`)
- `MCP_BRIDGE_PUBLIC_HOST` - Advertised hostname (auto-detected)
- `MCP_BRIDGE_PUBLIC_SCHEME` - Protocol scheme (`http`/`https`/`ws`/`wss`)
- `MCP_BRIDGE_USE_TLS` - Enable TLS (`true`/`false`)
- `MCP_SSE_PATH` - SSE endpoint path (default: `/sse`)
- `MCP_HTTP_PATH` - HTTP endpoint path (default: `/http`)
- `MCP_BRIDGE_WS_PATH` - WebSocket path (default: `/`)

**Optional - Logging:**
- `MCP_BRIDGE_STORE_LOGS` - Enable file logging (`true`/`false`, default: `false`)
- `MCP_BRIDGE_LOG_DIR` - Log directory (default: `./app/logs`)
- `MCP_BRIDGE_LOG_LEVEL` - Log level (default: `debug`)
- `MCP_BRIDGE_ROTATE_DATEPATTERN` - Log rotation pattern (default: `YYYY-MM-DD`)
- `MCP_BRIDGE_MAX_LOG_SIZE` - Max log size (default: `20m`)
- `MCP_BRIDGE_MAX_FILES` - Log retention (default: `14d`)
- `MCP_BRIDGE_COMPRESS_AFTER_HOURS` - Log compression delay (default: `1`)
- `LOG_LEVEL` - Alternative log level variable
- `DEBUG` - Enable debug package logging

**Optional - Advanced:**
- `ACTUAL_BUDGET_PASSWORD` - Budget encryption password
- `SKIP_BUDGET_DOWNLOAD` - Skip budget download on connect
- `ACTUAL_API_CONCURRENCY` - Max concurrent API calls (default: `6`)
- `MCP_BRIDGE_DEBUG_TRANSPORT` - Extra transport logging
- `MCP_SSE_AUTHORIZATION` - SSE authorization token

---

## 3. AI Agent Interaction Guide

### 3.1 Running the Project

**Prerequisites:**
```bash
# Install Node.js 20+
nvm install 20
nvm use 20

# Install dependencies
npm install

# Build TypeScript
npm run build
```

**Configuration:**
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your values
nano .env
# Set: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID
```

**Execution Modes:**

1. **HTTP Server (Production):**
```bash
npm run build
node dist/src/index.js --http --debug
```

2. **Development with Auto-rebuild:**
```bash
npm run dev -- --http --debug
```

3. **Test Connection Only:**
```bash
npm run build
node dist/src/index.js --test-actual-connection
```

4. **Test All Tools:**
```bash
npm run build
node dist/src/index.js --test-actual-tools
```

5. **Docker:**
```bash
docker build -t actual-mcp-server:latest .
docker run -e ACTUAL_SERVER_URL=http://actual:5006 \
           -e ACTUAL_PASSWORD=secret \
           -e ACTUAL_BUDGET_SYNC_ID=abc123 \
           -p 3600:3000 \
           actual-mcp-server:latest
```

### 3.2 Reading & Modifying Configuration

**Programmatic Config Access:**
```typescript
import config from './src/config.js';

// Read configuration
const serverUrl = config.ACTUAL_SERVER_URL;
const dataDir = config.MCP_BRIDGE_DATA_DIR;

// Configuration is validated at startup, no need to check again
```

**Runtime State Access:**
```typescript
import { getConnectionState } from './src/actualConnection.js';

const state = getConnectionState();
if (state.initialized) {
  // Connected and ready
} else if (state.initializationError) {
  // Connection failed
  console.error(state.initializationError);
}
```

### 3.3 Extending Functionality

#### Adding a New MCP Tool

**Step 1: Create tool file (src/tools/my_new_tool.ts)**
```typescript
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  param1: z.string().describe('Parameter description'),
  param2: z.number().optional(),
});

const tool: ToolDefinition = {
  name: 'actual.my.tool',
  description: 'Tool description for AI agents',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const validated = InputSchema.parse(args);
    
    // Call adapter function or implement logic
    const result = await adapter.someMethod(validated.param1);
    
    return { result };
  },
};

export default tool;
```

**Step 2: Export from index (src/tools/index.ts)**
```typescript
export { default as my_new_tool } from './my_new_tool.js';
```

**Step 3: Tool is automatically registered on server start**
No additional steps needed - `actualToolsManager` will discover it.

#### Adding a New Adapter Function

**Step 1: Add raw API import (src/lib/actual-adapter.ts)**
```typescript
import {
  myNewMethod as rawMyNewMethod,
} from '@actual-app/api/dist/methods.js';
```

**Step 2: Add wrapped function**
```typescript
export async function myNewMethod(param: string): Promise<ResultType> {
  observability.incrementToolCall('actual.my.method').catch(() => {});
  return await withConcurrency(() => 
    retry(() => rawMyNewMethod(param) as Promise<ResultType>, 
      { retries: 2, backoffMs: 200 }
    )
  );
}
```

**Step 3: Export in default object**
```typescript
export default {
  // ... existing exports
  myNewMethod,
};
```

#### Adding a New Server Transport

**Step 1: Create server file (src/server/myServer.ts)**
```typescript
import type { ActualMCPConnection } from '../lib/ActualMCPConnection.js';
import logger from '../logger.js';

export async function startMyServer(
  mcp: ActualMCPConnection,
  port: number,
  options: Record<string, unknown>
) {
  logger.info('Starting My Server...');
  
  // Implement server logic
  // Listen for connections
  // Route requests to mcp.executeTool()
  
  logger.info(`My Server listening on port ${port}`);
}
```

**Step 2: Import in index.ts**
```typescript
const { startMyServer } = await import('./server/myServer.js');
```

**Step 3: Add CLI flag and startup logic**
```typescript
const useMyServer = args.includes('--my-server');

if (useMyServer) {
  logger.info('Mode: My Server');
  await startMyServer(mcp, PORT, options);
}
```

### 3.4 Automation Scripts

**Test Scripts (package.json):**
```json
{
  "test:unit-js": "Run JavaScript unit tests",
  "test:adapter": "Test adapter layer with Actual API",
  "test:e2e": "Run Playwright end-to-end tests",
  "test:mcp-client": "Test MCP client integration",
  "test:librechat-docker": "Test LibreChat Docker integration",
  "test:docker-actual": "Test with Docker Actual instance",
  "test:docker-actual-auto": "Automated Docker test with fake data",
  "test:e2e-full-stack": "Full stack end-to-end test",
  "test:all": "Run all test suites",
  "test:quick": "Run quick test subset"
}
```

**Build & Generation:**
```json
{
  "build": "Compile TypeScript to dist/",
  "generate-tools": "Auto-generate tools from OpenAPI spec",
  "verify-tools": "Validate tool implementations"
}
```

**Shell Scripts (test/):**
- `docker-actual-test.sh` - Manual Docker test workflow
- `docker-actual-automated.sh` - Automated Docker test with seeding
- `e2e-full-stack.sh` - Full stack integration test
- `run-librechat-docker-test.sh` - LibreChat integration test

### 3.5 Sample AI Agent Prompts

**Prompt 1: List all accounts**
```
Use the actual.accounts.list tool to show me all my accounts.
```

**Prompt 2: Get recent transactions**
```
Show me transactions from my checking account for the last 30 days.
Use actual.transactions.get with accountId from actual.accounts.list.
```

**Prompt 3: Create a transaction**
```
Add a transaction:
- Account: "Checking"
- Amount: -45.50 (negative = expense)
- Description: "Coffee shop"
- Date: today
- Category: "Food & Dining"
```

**Prompt 4: Set budget amount**
```
Set my "Groceries" budget to $600 for this month.
Use actual.budgets.setAmount.
```

**Prompt 5: Check account balance**
```
What's my current checking account balance?
Use actual.accounts.get.balance.
```

### 3.6 Testing for AI Agents

**Quick Health Check:**
```bash
# Test Actual connection
npm run build && node dist/src/index.js --test-actual-connection

# Test all tools
npm run build && node dist/src/index.js --test-actual-tools
```

**E2E Test:**
```bash
# Run Playwright tests
npm run test:e2e
```

**Integration Test:**
```bash
# Test with Docker Actual instance
npm run test:docker-actual-auto
```

**Observability:**
```bash
# Check metrics (if Prometheus enabled)
curl http://localhost:3600/metrics

# Check logs
tail -f app/logs/actual-mcp-server.log
```

### 3.7 API Coverage and Implementation Roadmap

**Current Implementation Status (as of November 2025):**

The Actual MCP Server provides a subset of the Actual Finance API as MCP tools. Coverage tracking is automated through `npm run check:coverage` which compares available Actual API methods with implemented MCP tools.

**Coverage Statistics:**

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Actual API Methods** | 49 | 100% |
| **Implemented MCP Tools** | 14 | 29% |
| **Mapped but Not Implemented** | 18 | 37% |
| **Unmapped API Methods** | 17 | 35% |

**Implementation Strategy:**

The project uses a **staged implementation approach**, prioritizing tools based on:
1. **User Frequency** - Most commonly used operations first
2. **CRUD Completeness** - Complete Create, Read, Update, Delete for each entity type
3. **AI Agent Value** - Operations that enable powerful AI-driven workflows

**Phase 1: Core Operations (✅ COMPLETE)**

Implemented 14 tools covering basic CRUD for accounts, transactions, budgets, categories, and payees:

- ✅ `actual_accounts_list` - List all accounts
- ✅ `actual_accounts_create` - Create new account
- ✅ `actual_accounts_update` - Update account details
- ✅ `actual_accounts_get_balance` - Get account balance
- ✅ `actual_transactions_create` - Create transaction(s)
- ✅ `actual_transactions_get` - Query transactions
- ✅ `actual_transactions_import` - Import transactions from file
- ✅ `actual_budgets_getMonths` - List available budget months
- ✅ `actual_budgets_getMonth` - Get budget details for specific month
- ✅ `actual_budgets_setAmount` - Set budget amount for category
- ✅ `actual_categories_get` - List all categories
- ✅ `actual_categories_create` - Create new category
- ✅ `actual_payees_get` - List all payees
- ✅ `actual_payees_create` - Create new payee

**Phase 2: CRUD Completion (🔄 NEXT - Target: 42% → 65% coverage)**

Complete the CRUD operations for existing entity types. These tools are already mapped in `actualToolsManager.ts` and just need implementation:

**High Priority (Most Frequently Used):**
- ⏳ `actual_transactions_update` - Update existing transaction
- ⏳ `actual_transactions_delete` - Delete transaction
- ⏳ `actual_accounts_delete` - Close/delete account
- ⏳ `actual_categories_update` - Update category details
- ⏳ `actual_categories_delete` - Delete category
- ⏳ `actual_payees_update` - Update payee details
- ⏳ `actual_payees_delete` - Delete payee

**Medium Priority (Useful for Completeness):**
- ⏳ `actual_budgets_setCarryover` - Set budget carryover flag
- ⏳ `actual_accounts_close` - Mark account as closed
- ⏳ `actual_accounts_reopen` - Reopen closed account

**Phase 3: Rules & Automation (📋 PLANNED - Target: 65% → 80% coverage)**

Enable advanced automation through budget rules:

- ⏳ `actual_rules_get` - List all budget rules
- ⏳ `actual_rules_create` - Create new rule
- ⏳ `actual_rules_update` - Update rule conditions/actions
- ⏳ `actual_rules_delete` - Delete rule

**Phase 4: Category Groups (📋 PLANNED - Target: 80% → 88% coverage)**

Support hierarchical category organization:

- ⏳ `actual_category_groups_get` - List category groups
- ⏳ `actual_category_groups_create` - Create new group
- ⏳ `actual_category_groups_update` - Update group details
- ⏳ `actual_category_groups_delete` - Delete group

**Phase 5: Advanced Operations (🔮 FUTURE)**

High-value operations for power users and AI agents:

- 🔮 `actual_batch_budget_updates` - Batch update multiple budget amounts
- 🔮 `actual_common_payees_get` - Get frequently used payees
- 🔮 `actual_payees_merge` - Merge duplicate payees
- 🔮 `actual_payee_rules_get` - Get rules associated with payee
- 🔮 `actual_bank_sync_run` - Trigger bank synchronization

**Excluded from Roadmap (Out of Scope):**

These API methods are intentionally not exposed as MCP tools:

- `init`, `shutdown`, `sync` - Lifecycle management (handled internally)
- `loadBudget`, `downloadBudget` - Budget management (handled by server)
- `runQuery`, `aqlQuery`, `q` - Direct database queries (too low-level for AI)
- `runImport` - Import wizard (use `actual_transactions_import` instead)
- `holdBudgetForNextMonth`, `resetBudgetHold` - Advanced budget features (low priority)

**Checking Coverage:**

To see current implementation status:

```bash
# Check API coverage statistics
npm run check:coverage

# View tool mapping in code
# See src/actualToolsManager.ts:
#   - IMPLEMENTED_TOOLS constant (line 11-26)
#   - API_TOOL_MAP constant (line 28-61)
#   - getCoverageStats() method

# Programmatic access
import { actualToolsManager } from './src/actualToolsManager.js';
const stats = actualToolsManager.getCoverageStats();
console.log(`Coverage: ${stats.coveragePercent}%`);
console.log(`Missing: ${stats.missingToolsList}`);
```

**Implementation Guidelines for New Tools:**

When implementing a new tool from the roadmap:

1. **Create tool file**: `src/tools/[entity]_[operation].ts`
2. **Follow naming convention**: Use `actual_entity_operation` format (underscores, not dots)
3. **Define Zod schema**: Input schema must be `z.object()` at root level
4. **Implement handler**: Call corresponding method from `src/lib/actual-adapter.ts`
5. **Add to index**: Export from `src/tools/index.ts`
6. **Update constant**: Add tool name to `IMPLEMENTED_TOOLS` in `actualToolsManager.ts`
7. **Test**: Verify with LibreChat or `npm run test:docker-actual-auto`
8. **Update coverage**: Run `npm run check:coverage` to confirm

**Example Implementation (Transactions Update):**

```typescript
// src/tools/transactions_update.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { updateTransaction } from '../lib/actual-adapter.js';

const inputSchema = z.object({
  id: z.string().describe('Transaction ID'),
  fields: z.object({
    amount: z.number().optional().describe('New amount in cents'),
    payee: z.string().optional().describe('New payee ID'),
    notes: z.string().optional().describe('New notes'),
    date: z.string().optional().describe('New date (YYYY-MM-DD)'),
  }).describe('Fields to update'),
});

export const transactions_update: Tool = {
  name: 'actual_transactions_update',
  description: 'Update an existing transaction in Actual Budget',
  inputSchema: inputSchema,
};

export async function handle_transactions_update(args: z.infer<typeof inputSchema>) {
  return await updateTransaction(args.id, args.fields);
}
```

**Milestone Targets:**

- **Q4 2025**: Complete Phase 2 (65% coverage) - CRUD operations
- **Q1 2026**: Complete Phase 3 (80% coverage) - Rules & automation
- **Q2 2026**: Complete Phase 4 (88% coverage) - Category groups
- **Q3 2026**: Evaluate Phase 5 based on user feedback

---

## 4. Refactoring Opportunities

### 4.1 Code Quality Issues

#### Redundant & Duplicated Code

**Issue 1: Duplicate Error Handling**
- **Location**: Multiple server files (`httpServer.ts`, `sseServer.ts`, `wsServer.ts`)
- **Problem**: Each server has near-identical error handling and logging setup
- **Suggestion**: Extract common server middleware to `src/server/middleware.ts`

**Issue 2: Repeated Tool Schema Conversion**
- **Location**: `ActualMCPConnection.ts`, `httpServer.ts`
- **Problem**: `zodToJsonSchema()` called in multiple places
- **Suggestion**: Pre-compute schemas in `actualToolsManager.initialize()`

**Issue 3: Duplicate Normalization Logic**
- **Location**: `actual-adapter.ts` has multiple normalize functions
- **Problem**: Similar patterns for normalizing different response types
- **Suggestion**: Create generic `normalizeResponse<T>()` utility

**Issue 4: Repeated Environment Variable Checks**
- **Location**: Throughout `index.ts`, `logger.ts`, `actualConnection.ts`
- **Problem**: `process.env` accessed directly in many places
- **Suggestion**: Centralize all env vars in `config.ts`

#### Unused & Dead Code

**Issue 1: Unused Imports**
- **Location**: Several tool files import types never used
- **Tool**: Run `npx eslint --rule 'unused-imports/no-unused-imports: error'`

**Issue 2: Commented-Out Code**
- **Location**: `test/unit/transactions_create.test.ts` line 10
- **Problem**: Commented `process.exit(2)` left in code
- **Suggestion**: Remove or convert to proper test skip

**Issue 3: Demo Tools Never Used**
- **Location**: `ActualMCPConnection.ts` has `search.docs` and `math.add` fallback tools
- **Problem**: Production code includes test tools
- **Suggestion**: Move demo tools to separate test helper

**Issue 4: IMPLEMENTED_TOOLS Constant Unused**
- **Location**: `actualToolsManager.ts` line 13-16
- **Problem**: Constant defined but never referenced
- **Suggestion**: Remove or implement coverage tracking

#### Inconsistent Naming

**Issue 1: Mixed Naming Conventions**
- Files use both snake_case (`accounts_list.ts`) and camelCase (`ActualMCPConnection.ts`)
- **Suggestion**: Standardize on camelCase for TypeScript files

**Issue 2: Inconsistent Function Prefixes**
- Some functions: `get`, `fetch`, `retrieve` used interchangeably
- **Suggestion**: Use `get` for synchronous, `fetch` for async operations

**Issue 3: Abbreviations**
- `mcp`, `sse`, `ws` used without context in variable names
- **Suggestion**: Use full names or add context: `mcpConnection`, `sseTransport`

**Issue 4: Tool Naming Inconsistency**
- Tools use both dot notation (`actual.accounts.list`) and underscore (`accounts_list.ts`)
- **Suggestion**: Align file names with tool names

#### Large Functions

**Issue 1: `main()` in index.ts (150+ lines)**
- **Problem**: Too many responsibilities (initialization, config, server startup)
- **Suggestion**: Split into:
  - `initializeApplication()`
  - `setupCapabilities()`
  - `startServer(mode, options)`

**Issue 2: `startHttpServer()` (278 lines)**
- **Problem**: Handles request routing, middleware, error handling, MCP logic
- **Suggestion**: Extract:
  - `setupExpressMiddleware(app)`
  - `setupMCPRoutes(app, mcp, tools)`
  - `createTransportHandler(mcp)`

**Issue 3: `ActualDataSeeder.seedData()` (test file)**
- **Problem**: Sequential seeding logic too long
- **Suggestion**: Split into separate seed methods per entity type

#### Deeply Nested Logic

**Issue 1: Try-catch Pyramid in `connectToActual()`**
- **Location**: `actualConnection.ts` lines 50-70
- **Problem**: Multiple nested try-catch blocks for budget password handling
- **Suggestion**: Extract `downloadBudgetWithPassword()` helper

**Issue 2: Nested Conditionals in Server Mode Selection**
- **Location**: `index.ts` lines 250-275
- **Problem**: Multiple if-else for mode selection
- **Suggestion**: Use strategy pattern or command registry

**Issue 3: Deep Nesting in MCP Request Handlers**
- **Location**: Various server files
- **Problem**: Request validation, tool lookup, execution, error handling all nested
- **Suggestion**: Use middleware chain or pipeline pattern

#### Tight Coupling

**Issue 1: Direct Import of Singleton**
- **Problem**: Many files directly import `actualToolsManager`, `logger`, `config`
- **Impact**: Hard to test, no dependency injection
- **Suggestion**: Use dependency injection or service locator pattern

**Issue 2: Adapter Tightly Coupled to Observability**
- **Location**: `actual-adapter.ts` calls `observability.incrementToolCall()` in every function
- **Problem**: Can't use adapter without observability
- **Suggestion**: Emit events that observability listens to

**Issue 3: Server Implementations Know Tool Details**
- **Problem**: Servers directly access tool schemas and call `actualToolsManager`
- **Suggestion**: Server should only know about `MCPConnection` interface

**Issue 4: Tests Import Production Code Directly**
- **Problem**: Tests tightly coupled to implementation details
- **Suggestion**: Test through public interfaces only

### 4.2 Suggested Refactorings

#### Refactoring 1: Extract Server Factory

**Before:**
```typescript
if (useHttp) {
  await startHttpServer(mcp, PORT, ...10 parameters);
} else if (useWebSocket) {
  await startWsServer(mcp, PORT);
} else if (useSSE) {
  await startSseServer(mcp, PORT, SSE_PATH);
}
```

**After:**
```typescript
const serverConfig = {
  mode: args.includes('--http') ? 'http' : 
        args.includes('--ws') ? 'ws' : 'sse',
  port: PORT,
  path: HTTP_PATH,
  capabilities,
  tools: implementedTools,
  // ... other config
};

const server = ServerFactory.create(serverConfig, mcp);
await server.start();
```

#### Refactoring 2: Introduce Tool Registry Interface

**Before:**
```typescript
// Direct access everywhere
import actualToolsManager from './actualToolsManager.js';
const tool = actualToolsManager.getTool(name);
```

**After:**
```typescript
interface IToolRegistry {
  initialize(): Promise<void>;
  getToolNames(): string[];
  getTool(name: string): ToolDefinition | undefined;
  callTool(name: string, args: unknown): Promise<unknown>;
}

// Inject where needed
constructor(private toolRegistry: IToolRegistry) {}
```

#### Refactoring 3: Normalize Response Strategy

**Before:**
```typescript
function normalizeToTransactionArray(raw) { ... }
function normalizeToId(raw) { ... }
function normalizeImportResult(raw) { ... }
```

**After:**
```typescript
interface ResponseNormalizer<T> {
  normalize(raw: unknown): T;
}

class TransactionArrayNormalizer implements ResponseNormalizer<Transaction[]> {
  normalize(raw: unknown): Transaction[] { ... }
}

// Usage
const normalizer = NormalizerFactory.create<Transaction[]>('transactionArray');
return normalizer.normalize(rawResponse);
```

#### Refactoring 4: Configuration Service

**Before:**
```typescript
// Scattered throughout codebase
const port = process.env.MCP_BRIDGE_PORT ? Number(process.env.MCP_BRIDGE_PORT) : 3600;
const logLevel = process.env.LOG_LEVEL || 'debug';
```

**After:**
```typescript
class ConfigService {
  private static instance: ConfigService;
  
  get<T>(key: ConfigKey, defaultValue?: T): T {
    // Unified access with type safety
  }
  
  validate(): void {
    // Centralized validation
  }
}

// Usage
const port = ConfigService.getInstance().get('MCP_BRIDGE_PORT', 3600);
```

#### Refactoring 5: Adapter Event Bus

**Before:**
```typescript
export async function getAccounts() {
  observability.incrementToolCall('actual.accounts.list').catch(() => {});
  return await withConcurrency(/* ... */);
}
```

**After:**
```typescript
class AdapterEventBus extends EventEmitter {}

export async function getAccounts() {
  adapterEvents.emit('toolCall', { name: 'actual.accounts.list', timestamp: Date.now() });
  return await withConcurrency(/* ... */);
}

// In observability.ts
adapterEvents.on('toolCall', (event) => {
  incrementToolCall(event.name);
});
```

### 4.3 Design Pattern Improvements

**Pattern 1: Chain of Responsibility for Request Handling**
```typescript
interface RequestHandler {
  setNext(handler: RequestHandler): RequestHandler;
  handle(request: MCPRequest): Promise<MCPResponse>;
}

class ValidationHandler implements RequestHandler { ... }
class ToolLookupHandler implements RequestHandler { ... }
class ExecutionHandler implements RequestHandler { ... }
class ErrorHandler implements RequestHandler { ... }
```

**Pattern 2: Builder for Server Configuration**
```typescript
const server = new MCPServerBuilder()
  .withTransport('http')
  .withPort(3600)
  .withCapabilities(capabilities)
  .withTools(toolRegistry)
  .withLogging(logger)
  .build();
```

**Pattern 3: Repository Pattern for Tool Storage**
```typescript
interface IToolRepository {
  findAll(): ToolDefinition[];
  findByName(name: string): ToolDefinition | null;
  save(tool: ToolDefinition): void;
}

class ToolRepository implements IToolRepository { ... }
```

### 4.4 Technical Debt

**Debt 1: No Type Safety in MCP Protocol**
- `any` used extensively in server implementations
- **Impact**: Runtime errors, poor IDE support
- **Cost**: 4-6 hours to add proper MCP types

**Debt 2: No Request Validation at Transport Layer**
- Validation only happens at tool level
- **Impact**: Confusing errors for malformed requests
- **Cost**: 2-3 hours to add JSON-RPC validation

**Debt 3: Singleton Dependencies Prevent Testing**
- Can't easily mock `logger`, `config`, `actualToolsManager`
- **Impact**: Limited unit test coverage
- **Cost**: 8-12 hours to refactor to DI

**Debt 4: No Connection Pooling**
- Each request creates new connection overhead
- **Impact**: Performance bottleneck under load
- **Cost**: 4-6 hours to implement pooling

**Debt 5: Hard-coded Retry Parameters**
- Retry counts and backoff times are fixed
- **Impact**: Can't tune for different environments
- **Cost**: 1-2 hours to make configurable

**Debt 6: No Graceful Shutdown**
- Server doesn't handle SIGTERM/SIGINT properly
- **Impact**: Potential data loss, incomplete transactions
- **Cost**: 3-4 hours to implement proper shutdown

### 4.5 Performance Bottlenecks

**Bottleneck 1: Sequential Tool Initialization**
- Tools loaded one-by-one in `actualToolsManager.initialize()`
- **Solution**: Use `Promise.all()` for parallel loading

**Bottleneck 2: Synchronous JSON Parsing**
- Large responses block event loop
- **Solution**: Use streaming JSON parser or worker threads

**Bottleneck 3: No Response Caching**
- Same queries (e.g., getAccounts) hit API repeatedly
- **Solution**: Add Redis/memory cache with TTL

**Bottleneck 4: Concurrency Limiter Implementation**
- Simple queue doesn't prioritize requests
- **Solution**: Use `p-queue` with priority support

**Bottleneck 5: Log File I/O**
- Synchronous log writes can block
- **Solution**: Already using winston async transport, ensure it's configured correctly

---

## 5. Testing & Reliability

### 5.1 Test Coverage Summary

**Test Framework:** Playwright (E2E) + custom Node.js scripts (integration/unit)

**Test Structure:**
```
test/
├── e2e/                          # End-to-end tests (Playwright)
│   └── mcp-client.playwright.spec.ts
├── integration/                  # Integration tests
│   ├── librechat-docker.test.ts  # LibreChat integration
│   ├── librechat-probe.test.ts   # LibreChat connection probe
│   └── mcp-http.test.ts          # HTTP transport test
├── unit/                         # Unit tests
│   ├── adapter_normalization.test.ts
│   └── transactions_create.test.ts
└── docker-actual-test/           # Docker test infrastructure
    ├── seed-data.ts              # Test data seeder
    └── generate-fake-data.ts     # Fake financial data generator
```

**Current Coverage:**

| Layer | Coverage | Status |
|-------|----------|--------|
| **E2E (MCP Protocol)** | ✅ 80% | Well-tested |
| **Integration (Actual API)** | ⚠️ 60% | Partial |
| **Integration (LibreChat)** | ⚠️ 40% | Manual only |
| **Unit (Adapter)** | ⚠️ 50% | Basic coverage |
| **Unit (Tools)** | ❌ 20% | Minimal |
| **Unit (Server Transports)** | ❌ 10% | Mostly untested |

**Test Scripts:**
- `npm run test:adapter` - Test adapter layer with live Actual API
- `npm run test:e2e` - Run Playwright E2E tests
- `npm run test:mcp-client` - Test MCP client integration
- `npm run test:docker-actual` - Manual Docker integration test
- `npm run test:docker-actual-auto` - Automated Docker test with fake data
- `npm run test:librechat` - LibreChat Docker integration test
- `npm run test:all` - Full test suite (adapter + librechat + docker + e2e)
- `npm run test:quick` - Quick subset (adapter + docker + e2e)

### 5.2 Well-Tested Areas

**✅ MCP Protocol Compliance (E2E)**
- Initialize handshake
- Tool listing
- Tool execution
- SSE connection
- Well-known resource discovery
- Coverage: ~80%

**✅ Docker Integration**
- Automated Actual Budget deployment
- Data seeding with realistic fake data
- Full API coverage testing
- 14 tools verified end-to-end
- Coverage: ~90%

**✅ Adapter Normalization**
- Response type coercion
- ID extraction from various formats
- Transaction array normalization
- Import result parsing
- Coverage: ~70%

**✅ Connection Management**
- Actual API initialization
- Budget download
- Connection state tracking
- Retry logic
- Coverage: ~75%

### 5.3 Weakly Tested Areas

**⚠️ Individual Tool Implementations**
- **Problem**: Each tool file has minimal dedicated tests
- **Risk**: Parameter validation bugs, incorrect API mappings
- **Recommendation**: Add unit tests for each tool with mock adapter

**⚠️ Server Transport Layers**
- **Problem**: HTTP/WS/SSE servers mostly tested manually
- **Risk**: Protocol bugs, connection handling issues
- **Recommendation**: Add unit tests with mock connections

**⚠️ Error Handling Edge Cases**
- **Problem**: Happy path mostly tested, error paths less so
- **Risk**: Poor error messages, unhandled exceptions
- **Recommendation**: Add negative test cases for all tools

**⚠️ Concurrent Request Handling**
- **Problem**: No load testing or concurrent request tests
- **Risk**: Race conditions, concurrency bugs
- **Recommendation**: Add load tests with k6 or Artillery

**⚠️ Configuration Validation**
- **Problem**: Invalid env var handling not thoroughly tested
- **Risk**: Confusing startup errors
- **Recommendation**: Add config validation tests

**⚠️ Observability & Metrics**
- **Problem**: Prometheus metrics not tested
- **Risk**: Broken metrics, incorrect counts
- **Recommendation**: Add metrics verification tests

### 5.4 Missing Tests

**❌ Security & Authentication**
- No tests for SSE authorization token
- No tests for malicious input sanitization
- No tests for rate limiting

**❌ Data Consistency**
- No tests for transaction rollback
- No tests for partial failure recovery
- No tests for concurrent write conflicts

**❌ Performance & Scalability**
- No load tests
- No memory leak tests
- No connection pool exhaustion tests

**❌ Backwards Compatibility**
- No tests for Actual API version changes
- No tests for MCP protocol version negotiation

**❌ Network Resilience**
- No tests for network timeouts
- No tests for partial responses
- No tests for connection drops mid-request

**❌ Logging & Debugging**
- No tests for log output format
- No tests for debug flag behavior
- No tests for log rotation

### 5.5 Automated Testing Improvements

#### Improvement 1: Add Tool Test Generator

**Create:** `test/generators/tool-test-generator.ts`
```typescript
// Auto-generate test suite for each tool
for (const toolName of toolRegistry.getToolNames()) {
  describe(`Tool: ${toolName}`, () => {
    it('should validate input schema');
    it('should handle valid input');
    it('should reject invalid input');
    it('should handle API errors gracefully');
    it('should return expected output format');
  });
}
```

#### Improvement 2: Add Contract Tests

**Create:** `test/contracts/actual-api.contract.test.ts`
```typescript
// Verify assumptions about Actual API responses
describe('Actual API Contracts', () => {
  it('getAccounts returns array of Account objects');
  it('addTransactions accepts single or array');
  it('createCategory returns string ID or object with id');
  // ... etc
});
```

#### Improvement 3: Add Load Tests

**Create:** `test/load/k6-scenarios.js`
```javascript
// k6 load test scenarios
export default function() {
  // Scenario 1: Steady state (10 RPS)
  // Scenario 2: Spike (100 RPS for 30s)
  // Scenario 3: Stress test (increasing load to failure)
}
```

#### Improvement 4: Add Mutation Tests

**Add:** `stryker.conf.js` for mutation testing
```javascript
module.exports = {
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  testRunner: 'jest',
  // Find weak tests by mutating code and checking if tests fail
};
```

#### Improvement 5: Add Visual Regression Tests

**Add:** Playwright visual tests for error messages
```typescript
test('Tool error messages render correctly', async ({ page }) => {
  // Take screenshots of error states
  // Compare against baseline
});
```

### 5.6 CI/CD Integration

**Recommended GitHub Actions Workflow:**

```yaml
name: CI

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run lint

  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      actual:
        image: actualbudget/actual-server:latest
        ports:
          - 5006:5006
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:docker-actual-auto

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm audit
      - run: npx snyk test
```

---

## 6. Future Extensions

### 6.1 AI-Driven Automation Opportunities

**Opportunity 1: Natural Language Budget Management**
- **Description**: AI agent interprets complex budget commands
- **Example**: "Move $100 from Dining to Groceries for this month and reduce Dining budget by $100 next month"
- **Implementation**: Multi-step tool orchestration with context retention

**Opportunity 2: Automated Transaction Categorization**
- **Description**: AI learns from user's categorization patterns
- **Example**: "This looks like your usual coffee shop - categorize as Food & Dining?"
- **Implementation**: Add ML model training endpoint, store categorization rules

**Opportunity 3: Financial Insights & Alerts**
- **Description**: Proactive AI analysis of spending patterns
- **Example**: "Your grocery spending is 25% higher than average this month"
- **Implementation**: Add analytics tools, scheduled analysis jobs

**Opportunity 4: Budget Goal Tracking**
- **Description**: AI tracks progress toward financial goals
- **Example**: "You're on track to save $500 this month - 80% complete"
- **Implementation**: Add goal definition tools, progress calculation

**Opportunity 5: Bill Prediction & Reminders**
- **Description**: AI predicts upcoming bills based on history
- **Example**: "Your electricity bill is usually due in 3 days, typically $120"
- **Implementation**: Add recurring transaction detection, prediction model

**Opportunity 6: Conversational Budget Planning**
- **Description**: AI assists with budget creation through dialogue
- **Example**: "Based on your income, I recommend allocating 30% to housing, 15% to food..."
- **Implementation**: Add budget template tools, recommendation engine

### 6.2 New Feature Suggestions

**Feature 1: Multi-Budget Support**
- **Current**: Single budget per server instance
- **Proposed**: Dynamic budget switching via tool parameter
- **Benefit**: Manage multiple budgets (personal, business, family) from one server
- **Effort**: 8-12 hours

**Feature 2: Real-time Budget Sync**
- **Current**: Budget downloaded once at startup
- **Proposed**: WebSocket connection to Actual for live updates
- **Benefit**: AI agents see changes immediately
- **Effort**: 16-24 hours

**Feature 3: Transaction Import from Bank APIs**
- **Current**: Manual transaction creation
- **Proposed**: Plaid/Yodlee integration for automatic imports
- **Benefit**: Automated financial tracking
- **Effort**: 40-60 hours

**Feature 4: Budget Templates & Sharing**
- **Current**: No template system
- **Proposed**: Export/import budget structures
- **Benefit**: Quick setup, best practice sharing
- **Effort**: 12-16 hours

**Feature 5: Advanced Query Language**
- **Current**: Simple date range queries
- **Proposed**: SQL-like query interface for transactions
- **Benefit**: Complex financial analysis
- **Effort**: 24-32 hours

**Feature 6: Scheduled Reports**
- **Current**: No reporting
- **Proposed**: Weekly/monthly automated financial summaries
- **Benefit**: Proactive financial awareness
- **Effort**: 16-24 hours

**Feature 7: Multi-Currency Support**
- **Current**: Single currency
- **Proposed**: Multi-currency tracking with exchange rates
- **Benefit**: International finance management
- **Effort**: 20-30 hours

**Feature 8: Budget Scenario Planning**
- **Current**: Single budget view
- **Proposed**: "What-if" scenario modeling
- **Benefit**: Financial decision support
- **Effort**: 24-32 hours

### 6.3 Tooling Improvements

**Tool 1: Interactive Tool Tester**
- **Description**: Web UI to test MCP tools without client
- **Tech**: Express + simple HTML form
- **Benefit**: Faster development iteration
- **Effort**: 4-6 hours

**Tool 2: Tool Documentation Generator**
- **Description**: Auto-generate API docs from tool definitions
- **Tech**: TypeDoc + custom plugin
- **Benefit**: Always up-to-date documentation
- **Effort**: 6-8 hours

**Tool 3: OpenAPI Sync Monitor**
- **Description**: Alert when Actual API changes
- **Tech**: GitHub Action + diff checker
- **Benefit**: Catch breaking changes early
- **Effort**: 4-6 hours

**Tool 4: Performance Profiler**
- **Description**: Built-in performance monitoring
- **Tech**: Node.js profiler + flame graph generator
- **Benefit**: Identify bottlenecks
- **Effort**: 8-12 hours

**Tool 5: Configuration Validator CLI**
- **Description**: Validate .env before startup
- **Tech**: Command-line Zod validator
- **Benefit**: Better error messages
- **Effort**: 2-4 hours

**Tool 6: Mock Actual Server**
- **Description**: Fake Actual API for offline testing
- **Tech**: Express + in-memory SQLite
- **Benefit**: Test without real Actual instance
- **Effort**: 16-24 hours

### 6.4 CI/CD Improvements

**Improvement 1: Automated Release Pipeline**
- **Current**: Manual version bumps
- **Proposed**: Semantic release automation
- **Tools**: semantic-release, conventional commits
- **Benefit**: Consistent versioning, auto-generated changelogs
- **Effort**: 4-6 hours

**Improvement 2: Docker Image Scanning**
- **Current**: No security scanning
- **Proposed**: Trivy/Snyk container scanning
- **Benefit**: Catch vulnerabilities before deployment
- **Effort**: 2-3 hours

**Improvement 3: Preview Deployments**
- **Current**: Only main branch deployed
- **Proposed**: Deploy every PR to unique URL
- **Tools**: Vercel/Netlify or K8s namespaces
- **Benefit**: Test before merge
- **Effort**: 8-12 hours

**Improvement 4: Performance Budgets**
- **Current**: No performance tracking
- **Proposed**: CI fails if metrics regress
- **Tools**: Lighthouse CI, k6 thresholds
- **Benefit**: Prevent performance degradation
- **Effort**: 6-8 hours

**Improvement 5: Dependency Update Automation**
- **Current**: Manual dependency updates
- **Proposed**: Renovate/Dependabot with auto-merge
- **Benefit**: Stay up-to-date automatically
- **Effort**: 2-3 hours

### 6.5 Architecture Evolution

**Evolution 1: Microservices Split**
- **Current**: Monolithic server
- **Proposed**: Separate services for tools, transport, observability
- **Benefit**: Independent scaling, better separation
- **Effort**: 60-80 hours

**Evolution 2: Event-Driven Architecture**
- **Current**: Synchronous request/response
- **Proposed**: Event bus with async processing
- **Benefit**: Better scalability, resilience
- **Effort**: 40-60 hours

**Evolution 3: Plugin System**
- **Current**: Hard-coded tool registry
- **Proposed**: Dynamic plugin loading
- **Benefit**: Third-party tool development
- **Effort**: 24-32 hours

**Evolution 4: Multi-Tenant Support**
- **Current**: Single user per instance
- **Proposed**: Multiple users with isolation
- **Benefit**: SaaS deployment model
- **Effort**: 60-80 hours

**Evolution 5: GraphQL API**
- **Current**: MCP protocol only
- **Proposed**: Add GraphQL layer
- **Benefit**: Flexible queries, better tooling
- **Effort**: 32-40 hours

### 6.6 AI Agent Productivity Ideas

**Idea 1: Code Generation from Natural Language**
- **Description**: AI generates tool implementations from descriptions
- **Example**: "Create a tool that finds duplicate transactions"
- **Tech**: GPT-4 + code validation
- **Benefit**: Rapid feature development
- **Feasibility**: High (with proper validation)

**Idea 2: Automated Test Generation**
- **Description**: AI writes test cases from tool definitions
- **Example**: Parse Zod schema → generate property-based tests
- **Tech**: Fast-check + template generation
- **Benefit**: Comprehensive test coverage
- **Feasibility**: High

**Idea 3: Documentation Synthesis**
- **Description**: AI generates user docs from code
- **Example**: Analyze tool usage → create tutorial
- **Tech**: Code analysis + GPT-4
- **Benefit**: Always accurate docs
- **Feasibility**: Medium (requires validation)

**Idea 4: Intelligent Refactoring Suggestions**
- **Description**: AI identifies refactoring opportunities
- **Example**: "These 3 functions have similar structure - extract common pattern"
- **Tech**: AST analysis + pattern matching
- **Benefit**: Maintainable codebase
- **Feasibility**: Medium

**Idea 5: Automated Performance Optimization**
- **Description**: AI profiles code and suggests optimizations
- **Example**: "Cache this query result - it's called 50 times per request"
- **Tech**: Profiler + optimization patterns
- **Benefit**: Faster response times
- **Feasibility**: High

**Idea 6: Smart Error Diagnosis**
- **Description**: AI analyzes error logs and suggests fixes
- **Example**: "This timeout usually means network config issue - check MCP_BRIDGE_BIND_HOST"
- **Tech**: Log analysis + knowledge base
- **Benefit**: Faster troubleshooting
- **Feasibility**: High

---

## Appendix A: Quick Reference

### Essential Commands

```bash
# Development
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm run dev -- --http    # Start dev server (HTTP mode)

# Testing
npm run test:quick       # Quick test suite
npm run test:all         # Full test suite
npm run test:e2e         # E2E tests only

# Tools
npm run generate-tools   # Generate tools from OpenAPI
npm run verify-tools     # Validate tool implementations

# Production
docker build -t actual-mcp-server .
docker run -p 3600:3000 actual-mcp-server
```

### Environment Variables Cheat Sheet

```bash
# Required
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your_budget_id

# Server
MCP_BRIDGE_PORT=3600
MCP_BRIDGE_BIND_HOST=0.0.0.0

# Logging
MCP_BRIDGE_LOG_LEVEL=debug
MCP_BRIDGE_STORE_LOGS=true
```

### API Endpoints

```
HTTP:  http://localhost:3600/http
SSE:   http://localhost:3600/sse
WS:    ws://localhost:3600/
```

### Directory Map

```
src/             → Source code
test/            → Test suites
dist/            → Compiled output
actual-data/     → Actual Finance data
app/logs/        → Application logs
generated/       → Auto-generated types
scripts/         → Build scripts
types/           → Type definitions
```

---

## Appendix B: Tool Inventory

**Implemented Tools (14):**

| Tool Name | Description | Input | Output |
|-----------|-------------|-------|--------|
| `actual_accounts_list` | List all accounts | None | Account[] |
| `actual_accounts_create` | Create new account | Account details | Account ID |
| `actual_accounts_update` | Update account | ID + fields | Success |
| `actual_accounts_get_balance` | Get account balance | Account ID + date | Balance |
| `actual_transactions_create` | Create transactions | Transaction(s) | Transaction[] |
| `actual_transactions_get` | Query transactions | Account ID + dates | Transaction[] |
| `actual_transactions_import` | Import transactions | Account ID + data | Import result |
| `actual_budgets_getMonths` | List budget months | None | Month[] |
| `actual_budgets_getMonth` | Get month budget | Month | BudgetMonth |
| `actual_budgets_setAmount` | Set budget amount | Month + category + amount | Success |
| `actual_categories_get` | List categories | None | Category[] |
| `actual_categories_create` | Create category | Category details | Category ID |
| `actual_payees_get` | List payees | None | Payee[] |
| `actual_payees_create` | Create payee | Payee details | Payee ID |

> **Note:** Tool names use underscores (`_`) not dots (`.`) to comply with OpenAI API naming requirements (pattern: `^[a-zA-Z0-9_-]+$`). Previous versions used dot notation but this caused integration issues with LibreChat and other OpenAI-based clients.

**Planned Tools - Phase 2 (CRUD Completion):**

High Priority:
- `actual_transactions_update` - Update existing transaction
- `actual_transactions_delete` - Delete transaction
- `actual_accounts_delete` - Close/delete account
- `actual_categories_update` - Update category details
- `actual_categories_delete` - Delete category
- `actual_payees_update` - Update payee details
- `actual_payees_delete` - Delete payee

Medium Priority:
- `actual_budgets_setCarryover` - Set budget carryover flag
- `actual_accounts_close` - Mark account as closed
- `actual_accounts_reopen` - Reopen closed account

**Planned Tools - Phase 3 (Rules & Automation):**

- `actual_rules_get` - List all budget rules
- `actual_rules_create` - Create new rule
- `actual_rules_update` - Update rule conditions/actions
- `actual_rules_delete` - Delete rule

**Planned Tools - Phase 4 (Category Groups):**

- `actual_category_groups_get` - List category groups
- `actual_category_groups_create` - Create new group
- `actual_category_groups_update` - Update group details
- `actual_category_groups_delete` - Delete group

**Future Consideration (Phase 5):**

- `actual_batch_budget_updates` - Batch update multiple budget amounts
- `actual_common_payees_get` - Get frequently used payees
- `actual_payees_merge` - Merge duplicate payees
- `actual_payee_rules_get` - Get rules associated with payee
- `actual_bank_sync_run` - Trigger bank synchronization

For current implementation status, run: `npm run check:coverage`
- `actual.rules.update` - Update rule
- `actual.rules.delete` - Delete rule

---

## Appendix C: Common Issues & Solutions

**Issue 1: "Invalid or missing environment variables"**
- **Cause**: .env not configured
- **Solution**: Copy .env.example to .env and fill in values

**Issue 2: "Failed to connect to Actual Finance"**
- **Cause**: Wrong ACTUAL_SERVER_URL or Actual not running
- **Solution**: Check Actual is accessible at URL, test with curl

**Issue 3: "Budget not found"**
- **Cause**: Invalid ACTUAL_BUDGET_SYNC_ID
- **Solution**: Run `node test/get-actual-budgets.mjs` to find correct ID

**Issue 4: "Port already in use"**
- **Cause**: Another process using MCP_BRIDGE_PORT
- **Solution**: Change port in .env or kill conflicting process

**Issue 5: "Tools not loading"**
- **Cause**: Build not up-to-date
- **Solution**: Run `npm run build` before starting

**Issue 6: "Permission denied" in Docker**
- **Cause**: Non-root user can't write to volume
- **Solution**: Ensure volume permissions match container user (UID 1000)

---

**End of Document**

This analysis document is intended for AI agents and developers to understand the Actual MCP Server architecture, identify improvement opportunities, and extend functionality efficiently.
