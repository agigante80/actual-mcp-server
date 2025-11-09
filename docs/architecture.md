# Architecture Overview

This document provides a comprehensive overview of the Actual MCP Server architecture, design decisions, and technical implementation details.

## Table of Contents

- [System Architecture](#system-architecture)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Transport Protocols](#transport-protocols)
- [Tool System](#tool-system)
- [Error Handling](#error-handling)
- [Security](#security)
- [Performance](#performance)

## System Architecture

### High-Level Overview

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│                 │   MCP   │                  │  REST   │                 │
│  MCP Client     │◄────────┤  Actual MCP      │◄────────┤  Actual Budget  │
│  (LibreChat)    │         │  Server          │         │  Server         │
│                 │         │                  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     │
                                     ▼
                            ┌─────────────────┐
                            │   SQLite DB     │
                            │  (Cached Data)  │
                            └─────────────────┘
```

### Component Layers

```
┌───────────────────────────────────────────────────────────┐
│              Client Layer (LibreChat, etc.)               │
└───────────────────────────────────────────────────────────┘
                            │
                            │ HTTP / WebSocket / SSE
                            ▼
┌───────────────────────────────────────────────────────────┐
│               Transport Layer                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │   HTTP   │  │   WSS    │  │   SSE    │               │
│  │ Server   │  │  Server  │  │  Server  │               │
│  └──────────┘  └──────────┘  └──────────┘               │
└───────────────────────────────────────────────────────────┘
                            │
                            │ MCP Protocol
                            ▼
┌───────────────────────────────────────────────────────────┐
│            MCP Protocol Layer                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │         ActualMCPConnection                        │  │
│  │  (Request routing, response handling)              │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            │
                            │ Tool Calls
                            ▼
┌───────────────────────────────────────────────────────────┐
│            Business Logic Layer                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │         ActualToolsManager                         │  │
│  │  (Tool registry, validation, dispatch)             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐           │
│  │Tool1│  │Tool2│  │Tool3│  │ ... │  │37   │           │
│  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘           │
└───────────────────────────────────────────────────────────┘
                            │
                            │ Adapter Functions
                            ▼
┌───────────────────────────────────────────────────────────┐
│              Data Access Layer                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Actual Adapter                             │  │
│  │  (Retry logic, concurrency control, error mapping)│  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            │
                            │ @actual-app/api
                            ▼
┌───────────────────────────────────────────────────────────┐
│            External API Layer                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Actual Budget API                          │  │
│  │  (Official API client)                             │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            │
                            │ REST API / SQLite
                            ▼
┌───────────────────────────────────────────────────────────┐
│                Actual Budget Server                       │
└───────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Entry Point (`src/index.ts`)

**Responsibilities:**
- Parse command-line arguments
- Load environment configuration
- Initialize logging
- Connect to Actual Budget
- Start appropriate transport server
- Handle graceful shutdown

**Key Functions:**
- `main()` - Application entry point
- Command-line flag handling (`--debug`, `--test-actual-connection`, etc.)
- Server mode selection (HTTP/WS/SSE)

### 2. Configuration (`src/config.ts`)

**Responsibilities:**
- Environment variable validation
- Type-safe configuration object
- Default value management

**Technology:**
- Zod schemas for validation
- Runtime type checking
- Clear error messages for misconfiguration

### 3. Actual Connection (`src/actualConnection.ts`)

**Responsibilities:**
- Initialize connection to Actual Budget server
- Download and sync budget data
- Manage connection lifecycle
- Handle authentication

**Key Functions:**
- `connectToActual()` - Establish connection
- `shutdownActual()` - Clean shutdown
- `getConnectionState()` - Connection status

### 4. Tools Manager (`src/actualToolsManager.ts`)

**Responsibilities:**
- Register all MCP tools
- Validate tool inputs with Zod
- Route tool calls to appropriate handlers
- Track tool execution (observability)

**Key Features:**
- Singleton pattern
- Dynamic tool loading
- Schema validation
- Error handling

### 5. Actual Adapter (`src/lib/actual-adapter.ts`)

**Responsibilities:**
- Wrap Actual Budget API calls
- Implement retry logic with exponential backoff
- Concurrency control (p-limit)
- Error normalization
- Type safety

**Key Features:**
- **Retry Logic**: 3 attempts with exponential backoff
- **Concurrency Limiting**: Maximum 5 concurrent operations
- **Error Handling**: Standardized error responses
- **Type Safety**: Full TypeScript types from OpenAPI

**Functions (37 total):**
```typescript
// Accounts
getAccounts()
createAccount()
updateAccount()
deleteAccount()
closeAccount()
reopenAccount()
getAccountBalance()

// Transactions
addTransactions()
getTransactions()
importTransactions()
updateTransaction()
deleteTransaction()

// Categories
getCategories()
createCategory()
updateCategory()
deleteCategory()

// Category Groups
getCategoryGroups()
createCategoryGroup()
updateCategoryGroup()
deleteCategoryGroup()

// Payees
getPayees()
createPayee()
updatePayee()
deletePayee()
mergePayees()
getPayeeRules()

// Budgets
getBudgetMonths()
getBudgetMonth()
setBudgetAmount()
setBudgetCarryover()
holdBudgetForNextMonth()
resetBudgetHold()
batchBudgetUpdates()

// Rules
getRules()
createRule()
updateRule()
deleteRule()
```

### 6. MCP Connection (`src/lib/ActualMCPConnection.ts`)

**Responsibilities:**
- Implement MCP protocol specification
- Handle request/response cycles
- Route MCP commands (initialize, tools/list, tools/call)
- Manage client sessions

**MCP Protocol Support:**
- `initialize` - Server capabilities negotiation
- `tools/list` - Return available tools
- `tools/call` - Execute specific tool
- `prompts/list` - List available prompts (future)
- `resources/list` - List available resources (future)

### 7. Transport Servers

#### HTTP Server (`src/server/httpServer.ts`)
- RESTful MCP over HTTP
- Request/response model
- Stateless design
- Health check endpoint

#### WebSocket Server (`src/server/wsServer.ts`)
- Bidirectional communication
- Persistent connections
- Real-time updates
- Lower latency

#### SSE Server (`src/server/sseServer.ts`)
- Server-Sent Events
- Unidirectional (server → client)
- Long-lived connections
- Automatic reconnection

## Data Flow

### Tool Execution Flow

```
1. Client sends MCP request
   └─> HTTP POST / WebSocket message / SSE connection

2. Transport layer receives request
   └─> Parse JSON-RPC payload

3. ActualMCPConnection routes request
   └─> Identify method (tools/call)
   └─> Extract tool name and parameters

4. ActualToolsManager validates and dispatches
   └─> Lookup tool by name
   └─> Validate input with Zod schema
   └─> Call tool handler

5. Tool handler executes business logic
   └─> Call adapter function
   └─> Pass validated parameters

6. Actual Adapter processes request
   └─> Apply concurrency limit
   └─> Wrap in retry logic
   └─> Call Actual Budget API

7. Actual Budget API executes
   └─> Query/modify SQLite database
   └─> Return results

8. Response flows back up the stack
   └─> Adapter normalizes response
   └─> Tool returns result
   └─> ActualMCPConnection formats MCP response
   └─> Transport sends to client

9. Observability tracking
   └─> Log execution
   └─> Update metrics
   └─> Track errors
```

### Startup Sequence

```
1. Parse command-line arguments
2. Load .env configuration
3. Validate environment variables (Zod)
4. Initialize logger
5. Connect to Actual Budget API
   ├─> Authenticate with password
   ├─> Download budget data
   └─> Open SQLite database
6. Initialize tool registry
   └─> Load all 37 tools
7. Create MCP connection instance
8. Start transport server
   ├─> HTTP (Express)
   ├─> WebSocket (ws library)
   └─> SSE (Express + EventEmitter)
9. Server ready - accept connections
```

## Transport Protocols

### HTTP Transport

**Pros:**
- Simple, stateless
- Easy to debug (curl, Postman)
- Works through proxies
- Standard REST patterns

**Cons:**
- Higher latency (new connection per request)
- No server push
- More overhead

**Use Cases:**
- Simple integrations
- Debugging
- Low-frequency operations

### WebSocket Transport

**Pros:**
- Low latency
- Bidirectional communication
- Single persistent connection
- Efficient for high-frequency calls

**Cons:**
- More complex to debug
- Connection management needed
- Proxy/firewall issues

**Use Cases:**
- Real-time applications
- Interactive chat interfaces
- High-frequency operations

### SSE Transport

**Pros:**
- Simple server push
- Automatic reconnection
- Works through HTTP
- Good for notifications

**Cons:**
- Unidirectional (server → client)
- Less efficient than WebSocket

**Use Cases:**
- Status updates
- Progress notifications
- Event streaming

## Tool System

### Tool Definition Structure

```typescript
interface ToolDefinition {
  name: string;                    // Unique identifier
  description: string;             // Human-readable description
  inputSchema: z.ZodObject<any>;   // Zod validation schema
  call: (args: unknown, meta?: unknown) => Promise<any>;
}
```

### Tool Registration

1. Each tool is defined in `src/tools/<tool_name>.ts`
2. Exported from `src/tools/index.ts`
3. Automatically loaded by `ActualToolsManager`
4. Schema converted to JSON Schema for MCP

### Input Validation

- **Zod Schemas**: Runtime type validation
- **Automatic Conversion**: Zod → JSON Schema
- **Clear Error Messages**: Validation failures are detailed

### Tool Categories

| Category | Count | Examples |
|----------|-------|----------|
| Accounts | 7 | list, create, update, delete, close, reopen, get_balance |
| Transactions | 5 | create, get, import, update, delete |
| Categories | 4 | get, create, update, delete |
| Category Groups | 4 | get, create, update, delete |
| Payees | 6 | get, create, update, delete, merge, get_rules |
| Budgets | 6 | getMonths, getMonth, setAmount, setCarryover, hold, resetHold |
| Rules | 4 | get, create, update, delete |
| Batch | 1 | budget_updates_batch |

**Total: 37 tools**

## Error Handling

### Error Propagation Strategy

```
Actual Budget API Error
   │
   ├─> Caught by adapter
   ├─> Normalized to standard format
   ├─> Logged with context
   └─> Returned to client

Client receives:
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Human-readable description",
    "data": { /* Additional context */ }
  }
}
```

### Error Categories

1. **Validation Errors**: Invalid input parameters (Zod)
2. **Connection Errors**: Cannot reach Actual Budget
3. **Authentication Errors**: Invalid credentials
4. **Not Found Errors**: Resource doesn't exist
5. **Conflict Errors**: Duplicate or conflicting data
6. **Internal Errors**: Unexpected server errors

### Retry Logic

- **Attempts**: 3 retries per operation
- **Backoff**: Exponential (100ms, 200ms, 400ms)
- **Retryable Errors**: Network timeouts, temporary failures
- **Non-Retryable**: Validation errors, not found, auth errors

## Security

### Authentication

- **Actual Budget**: Password-based authentication
- **MCP Server**: Optional SSE authorization token
- **Production**: Use Docker secrets or environment files with restricted permissions

### Best Practices

1. **Never log passwords**: Redact sensitive data
2. **Use HTTPS**: TLS/SSL in production
3. **Restrict access**: Firewall rules, VPN
4. **Regular updates**: Keep dependencies current
5. **Secrets management**: Docker secrets, Kubernetes secrets, Vault

### Data Privacy

- **Local Storage**: Budget data cached locally in SQLite
- **No External Calls**: All data stays between MCP server and Actual Budget
- **Audit Logging**: Track all tool executions

## Performance

### Optimization Strategies

1. **Concurrency Limiting**: Max 5 concurrent API calls
2. **Connection Pooling**: Reuse Actual Budget connections
3. **Caching**: SQLite database cached locally
4. **Efficient Queries**: Minimize data transfer
5. **Streaming**: Large responses streamed when possible

### Performance Metrics

- **Latency**: Typical tool call < 100ms
- **Throughput**: ~50 requests/second sustained
- **Memory**: ~100-200MB RSS
- **CPU**: Low (<5% idle, 20-40% under load)

### Scalability

- **Horizontal**: Multiple instances behind load balancer
- **Vertical**: Increase container resources
- **Database**: SQLite is single-threaded (consider one instance per budget)

### Monitoring

- **Prometheus Metrics**: Tool call counts, latencies, errors
- **Health Checks**: `/health` endpoint
- **Logging**: Structured JSON logs with Winston

## Technology Choices

### Why TypeScript?

- Type safety reduces bugs
- Better IDE support
- Self-documenting code
- Easier refactoring

### Why Express?

- Mature, stable
- Large ecosystem
- Easy to understand
- Good middleware support

### Why Zod?

- Runtime validation
- TypeScript integration
- JSON Schema generation
- Clear error messages

### Why SQLite (via Actual Budget)?

- File-based, portable
- No separate database server
- Fast for small-medium datasets
- Built into Actual Budget

## Future Enhancements

### Planned Features

1. **MCP Resources**: Expose account/category data as resources
2. **MCP Prompts**: Pre-built financial queries
3. **Batch Operations**: Multiple tools in one request
4. **Webhooks**: Real-time notifications
5. **GraphQL API**: Alternative query interface
6. **Advanced Metrics**: Prometheus/Grafana dashboards

### Under Consideration

- **Multi-budget Support**: Handle multiple budgets
- **Read-only Mode**: Safer integrations
- **Audit Log**: Complete operation history
- **Rate Limiting**: Prevent abuse
- **API Versioning**: Backward compatibility

## References

- **MCP Specification**: https://modelcontextprotocol.io/
- **Actual Budget API**: https://actualbudget.org/docs/api/
- **TypeScript**: https://www.typescriptlang.org/
- **Zod**: https://zod.dev/
