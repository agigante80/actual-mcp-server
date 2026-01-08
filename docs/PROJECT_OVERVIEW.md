# Project Overview

**Project:** Actual MCP Server  
**Version:** 0.4.7  
**Status:** Production-ready with ongoing enhancements  
**Last Updated:** 2026-01-07  
**Assessment Score:** 88/100 (EXCELLENT)  
**Tool Count:** 51 MCP tools (verified LibreChat and LobeChat compatible)  
**Docker Images:** Available on Docker Hub and GitHub Container Registry

---

## 🎯 Purpose & Goals

### What is Actual MCP Server?

The **Actual MCP Server** is a production-ready bridge service that exposes [Actual Budget](https://actualbudget.org/) APIs through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). This enables AI assistants (primarily [LibreChat](https://www.librechat.ai/)) to interact with personal finance data through natural language conversations.

### Core Value Proposition

- **Conversational Finance Management**: Users can manage their budget, transactions, and financial data by simply talking to an AI assistant
- **AI-Native API Bridge**: Standardized MCP tools make Actual Budget accessible to any MCP-compatible AI client
- **Production-Ready Integration**: Fully tested and verified with LibreChat, ready for deployment
- **Multi-Transport Support**: HTTP and Server-Sent Events (SSE) transport protocols
- **Secure by Default**: Bearer token authentication, HTTPS support, and privacy-first design

### Problem Being Solved

1. **Manual Budget Management**: Traditional budget apps require manual data entry and navigation through complex UIs
2. **Limited Automation**: Actual Budget's API is not directly accessible to AI assistants
3. **Protocol Mismatch**: AI assistants use MCP protocol, but Actual Budget uses a custom REST API
4. **Integration Complexity**: Connecting AI chat platforms to personal finance tools requires significant development

### Target Audience

- **Primary**: LibreChat users who want AI-powered budget management
- **Secondary**: Developers building AI assistants with financial capabilities
- **Future**: Any MCP-compatible AI client (Claude Desktop, etc.)

---

## ✨ Core Features

### 🛠️ **49 MCP Tools**

Comprehensive coverage of Actual Budget functionality across 9 categories:

| Category | Tools | Coverage |
|----------|-------|----------|
| **Accounts** | 7 | Create, list, update, delete, close, reopen, get balance |
| **Transactions** | 12 | Create, get, update, delete, import, filter, search (4), summary (2) |
| **Budgets** | 8 | Get months, set amounts, transfers, carryover, holds |
| **Categories** | 4 | Create, list, update, delete |
| **Category Groups** | 4 | Create, list, update, delete |
| **Payees** | 6 | Create, list, update, delete, merge, get rules |
| **Rules** | 4 | Create, list, update, delete |
| **Advanced Query & Sync** | 2 | Custom ActualQL queries, bank synchronization |
| **Batch Operations** | 1 | Batch budget updates |
| **Server Info** | 1 | Server status and information |

**Total**: 51 tools with 82% coverage of Actual Budget core API

> ✅ **All 51 tools verified** with LibreChat integration testing  
> 🐳 **Docker images published** on Docker Hub and GitHub Container Registry  
> 📊 **README enhanced** with comprehensive badges and improved discoverability

### 🔄 **Transport Protocols**

- **HTTP (Recommended)**: `streamable-http` transport with Bearer token auth - **fully verified with LibreChat**
- **Server-Sent Events (SSE)**: Alternative streaming transport (auth limitations in LibreChat)

**Docker Default**: HTTP transport enabled by default, configurable via `MCP_TRANSPORT_MODE` environment variable

### 🔐 **Security & Authentication**

- **Bearer Token Authentication**: Optional `MCP_SSE_AUTHORIZATION` for secure API access
- **HTTPS Support**: TLS/SSL encryption for production deployments
- **Environment-Based Secrets**: No hardcoded credentials, Docker secrets support
- **Non-Root Container**: Security-hardened Docker image

### 📊 **Advanced Features**

- **Custom ActualQL Queries**: Execute complex data queries with `actual_query_run` tool
- **Bank Synchronization**: Trigger GoCardless/SimpleFIN sync with `actual_bank_sync` tool
- **Multi-Budget Support**: List and switch between budget files with `actual_budgets_get_all`
- **Transaction Import**: Bulk import with auto-reconciliation and duplicate prevention
- **Batch Operations**: Atomic batch updates for budget modifications

### 🚀 **Production-Ready**

- **Retry Logic**: Automatic retry with exponential backoff for failed API calls
- **Concurrency Control**: Prevents overwhelming Actual Budget server
- **Structured Logging**: Winston logger with daily rotation and debug mode
- **Health Endpoints**: `/health` endpoint for monitoring and load balancers
- **Prometheus Metrics**: Observability with `/metrics` endpoint
- **Docker Images**: Published to Docker Hub and GitHub Container Registry

---

## 🏗️ Technology Stack

### Runtime Environment

- **Node.js**: v20.x LTS (Alpine Linux in Docker)
- **TypeScript**: v5.9.2 with strict mode enabled
- **Module System**: ESM (ES2020 modules throughout)

### Core Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@actual-app/api` | ^25.11.0 | Official Actual Budget API client |
| `@modelcontextprotocol/sdk` | ^1.18.2 | MCP protocol implementation |
| `express` | ^4.21.2 | HTTP/SSE server framework |
| `winston` | ^3.18.3 | Structured logging |
| `zod` | (bundled) | Runtime type validation |
| `date-fns` | ^4.1.0 | Date manipulation |
| `dotenv` | ^17.2.2 | Environment configuration |

### Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| `@playwright/test` | ^1.56.0 | End-to-end testing |
| `typescript` | ^5.9.2 | TypeScript compiler |
| `openapi-typescript` | ^7.10.1 | Type generation from OpenAPI |
| `ts-node` | ^10.9.1 | TypeScript execution |
| `nodemon` | ^3.0.0 | Development hot-reload |

### Infrastructure

- **Docker**: Multi-stage builds, Alpine base image, non-root user
- **Docker Compose**: Development and production orchestration
- **GitHub Actions**: CI/CD pipeline with automated testing and deployment
- **SQLite**: Database backend (via Actual Budget)

---

## 🔌 Integration Points

### External APIs

#### 1. **Actual Budget Server** (Required)

- **Protocol**: REST API over HTTP/HTTPS
- **Connection**: Via `@actual-app/api` official client
- **Data Format**: JSON with SQLite backend
- **Authentication**: Password-based
- **Sync ID**: UUID for budget identification

**Required Configuration**:
```bash
ACTUAL_SERVER_URL=http://your-server:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your_sync_id
```

#### 2. **LibreChat** (Primary Client)

- **Protocol**: MCP over HTTP (`streamable-http`)
- **Integration**: LibreChat `mcpServers` configuration
- **Authentication**: Bearer token via headers
- **Status**: ✅ Fully verified - all 51 tools working

**LibreChat Configuration**:
```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "https://your-server:3600/http"
    headers:
      Authorization: "Bearer your_token"
    serverInstructions: true
```

#### 3. **Other MCP Clients** (Future)

- Claude Desktop
- Custom MCP-compatible clients
- Other AI assistant platforms

### Internal Components

- **Tool Registry**: `ActualToolsManager` - Dynamic tool registration and dispatch
- **Connection Manager**: `actualConnection.ts` - API lifecycle management
- **Adapter Layer**: `actual-adapter.ts` - Error handling, retry logic, concurrency control
- **Transport Servers**: HTTP and SSE implementations using official MCP SDK

---

## ⚠️ Limitations & Constraints

### Current Limitations

1. **Schedules Not Implemented** (4 tools)
   - `getSchedules()`, `createSchedule()`, `updateSchedule()`, `deleteSchedule()`
   - Reason: Requires internal Actual API access not exposed in standard methods
   - Status: Planned for future implementation

2. **Single Active Budget**
   - Only one budget can be active per server instance
   - Switching budgets requires reconnection
   - Multi-budget support exists but requires workflow improvements

3. **LibreChat SSE Authentication**
   - LibreChat's SSE client doesn't send custom headers
   - Workaround: Use HTTP transport for authenticated deployments
   - Status: LibreChat limitation, not MCP server issue

4. **Alpine Native Module Warnings**
   - `@actual-app/api` shows native module warnings on Alpine Linux
   - Impact: Non-blocking warnings, functionality not affected
   - Status: Known issue, considered acceptable

### Technical Constraints

1. **Database**: SQLite only (via Actual Budget)
2. **Actual Budget Version**: Requires compatible API version (25.11.0+)
3. **Node.js**: Requires v20.x or higher
4. **Memory**: Minimum 512MB RAM recommended for production

### Design Decisions

1. **Stateless Server**: No session persistence beyond Actual Budget connection
2. **Single Responsibility**: Pure bridge, no business logic beyond MCP translation
3. **Environment-First Config**: All configuration via environment variables
4. **Fail-Fast**: Invalid configuration prevents startup rather than runtime errors

---

## 🎯 Success Metrics

### Current Achievements

- ✅ **51 tools implemented** (82% of core API coverage)
- ✅ **LibreChat verified** - all tools loading and functional
- ✅ **Docker images published** - Docker Hub and GHCR
- ✅ **CI/CD pipeline** - automated testing and deployment
- ✅ **Security hardened** - Bearer auth, HTTPS, non-root container
- ✅ **Test coverage** - >80% unit test coverage

### Future Goals

- 🎯 Implement Schedules tools (4 tools) - target 100% API coverage
- 🎯 Add more integration tests for complex workflows
- 🎯 Improve error messages and user guidance
- 🎯 Performance optimization for large datasets
- 🎯 Support for additional MCP clients (Claude Desktop, etc.)

---

## 🔗 Related Resources

- **Official Documentation**: [GitHub Repository](https://github.com/agigante80/actual-mcp-server)
- **Docker Images**: 
  - [Docker Hub](https://hub.docker.com/r/agigante80/actual-mcp-server)
  - [GHCR](https://github.com/agigante80/actual-mcp-server/pkgs/container/actual-mcp-server)
- **Actual Budget**: [https://actualbudget.org/](https://actualbudget.org/)
- **LibreChat**: [https://www.librechat.ai/](https://www.librechat.ai/)
- **MCP Protocol**: [https://modelcontextprotocol.io/](https://modelcontextprotocol.io/)

---

## 📋 Next Steps

For detailed technical information, see:
- [Architecture](./ARCHITECTURE.md) - System design and component flow
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Testing strategy
- [Roadmap](./ROADMAP.md) - Future improvements and priorities
