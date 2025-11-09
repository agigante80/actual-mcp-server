# Actual MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.18-orange)](https://modelcontextprotocol.io/)

A production-ready **Model Context Protocol (MCP)** server that bridges AI assistants like [LibreChat](https://github.com/danny-avila/LibreChat) with [Actual Budget](https://actualbudget.org/), enabling natural language financial management through 39 specialized tools covering 78% of the Actual Budget API.

---

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Available Tools](#-available-tools)
- [Allowed vs Not Allowed Operations](#-allowed-vs-not-allowed-operations)
- [Installation](#-installation)
- [Usage Examples](#-usage-examples)
- [Configuration](#-configuration)
- [Transports & Authentication](#-transports--authentication)
- [Docker Deployment](#-docker-deployment)
- [Architecture](#-architecture)
- [API Coverage](#-api-coverage)
- [Contributing](#-contributing)
- [Documentation](#-documentation)
- [License](#-license)

---

## ✨ Features

### Core Capabilities

- 🤖 **39 MCP Tools**: Comprehensive financial operations via natural language
- 🔄 **Multiple Transports**: HTTP, WebSocket, and Server-Sent Events (SSE)
- � **Secure**: Bearer token authentication on all transports
- �🛡️ **Type-Safe**: Full TypeScript implementation with runtime validation (Zod)
- 🔁 **Resilient**: Automatic retry logic with exponential backoff
- 📊 **78% API Coverage**: Supports majority of Actual Budget operations
- 🚀 **Production-Ready**: Docker support, structured logging, health checks

### Advanced Features

- **Concurrent Control**: Rate-limited API calls prevent overwhelming Actual Budget
- **Observability**: Prometheus metrics, structured logging with Winston
- **Flexible Deployment**: Docker, Kubernetes, bare metal, or Docker Compose
- **Secure**: Bearer token authentication, Docker secrets support, environment-based configuration
- **Tested**: >80% test coverage with unit, integration, and E2E tests
- **LibreChat Ready**: Tested and verified with 39 tools loading successfully

### What You Can Do

With AI assistance, you can:

- 💰 **Manage Accounts**: Create, update, close accounts; check balances
- 💳 **Track Transactions**: Add, update, delete transactions; import bank data
- 📁 **Organize Categories**: Create category groups and categories
- 👥 **Handle Payees**: Manage payees, merge duplicates
- 📅 **Budget Planning**: Set budget amounts, enable carryover, track spending
- 🔧 **Automate Rules**: Create rules for automatic transaction categorization

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** or **Docker**
- **Actual Budget server** (running locally or hosted)
- Actual Budget credentials (password and sync ID)

### Install with npm

```bash
# Clone the repository
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Actual Budget credentials

# Build and run
npm run build
npm run dev -- --debug
```

### Run with Docker

```bash
# Quick start (use your credentials)
docker run -d \
  --name actual-mcp-server \
  -p 3000:3000 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest

# Check if running
curl http://localhost:3000/health
```

### Run with Docker Compose

```bash
# Full stack (Actual Budget + MCP Server)
docker compose --profile fullstack --profile dev up

# Access Actual Budget: http://localhost:5006
# Access MCP Server: http://localhost:3000
```

**Next Steps**: Connect your AI assistant (LibreChat, etc.) to `http://localhost:3000`

---

## 🛠️ Available Tools

The MCP server exposes **39 tools** organized into 8 categories. All tools follow the naming convention `actual_<category>_<action>`.

### Accounts (7 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_accounts_list` | List all accounts | - |
| `actual_accounts_create` | Create new account | `name`, `type`, `offbudget`, `closed` |
| `actual_accounts_update` | Update account details | `id`, `name?`, `type?`, `offbudget?`, `closed?` |
| `actual_accounts_delete` | Permanently delete account | `id` |
| `actual_accounts_close` | Close account (soft delete) | `id` |
| `actual_accounts_reopen` | Reopen closed account | `id` |
| `actual_accounts_get_balance` | Get account balance at date | `id`, `cutoff?` |

### Transactions (6 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_transactions_get` | Get transactions for account | `accountId`, `startDate?`, `endDate?` |
| `actual_transactions_filter` | Filter transactions with advanced criteria | `accountId?`, `startDate?`, `endDate?`, `minAmount?`, `maxAmount?`, `categoryId?`, `payeeId?`, `notes?`, `cleared?`, `reconciled?` |
| `actual_transactions_create` | Create new transaction(s) | `accountId`, `date`, `amount`, `payee?`, `category?`, `notes?` |
| `actual_transactions_import` | Import and reconcile transactions | `accountId`, `transactions[]` |
| `actual_transactions_update` | Update transaction | `id`, `amount?`, `payee?`, `category?`, `notes?`, `date?` |
| `actual_transactions_delete` | Delete transaction | `id` |

### Categories (4 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_categories_get` | List all categories | - |
| `actual_categories_create` | Create new category | `name`, `group_id`, `is_income?` |
| `actual_categories_update` | Update category | `id`, `name?`, `group_id?`, `is_income?` |
| `actual_categories_delete` | Delete category | `id` |

### Category Groups (4 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_category_groups_get` | List all category groups | - |
| `actual_category_groups_create` | Create category group | `name`, `is_income?` |
| `actual_category_groups_update` | Update group | `id`, `name?`, `is_income?` |
| `actual_category_groups_delete` | Delete group | `id` |

### Payees (6 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_payees_get` | List all payees | - |
| `actual_payees_create` | Create new payee | `name` |
| `actual_payees_update` | Update payee | `id`, `name?` |
| `actual_payees_delete` | Delete payee | `id` |
| `actual_payees_merge` | Merge duplicate payees | `targetId`, `mergeIds[]` |
| `actual_payee_rules_get` | Get rules for a payee | `payeeId` |

### Budgets (7 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_budgets_getMonths` | List available budget months | - |
| `actual_budgets_getMonth` | Get budget for specific month | `month` |
| `actual_budgets_setAmount` | Set category budget amount | `month`, `categoryId`, `amount` |
| `actual_budgets_transfer` | Transfer amount between categories | `month`, `fromCategoryId`, `toCategoryId`, `amount` |
| `actual_budgets_setCarryover` | Enable/disable carryover | `month`, `categoryId`, `flag` |
| `actual_budgets_holdForNextMonth` | Hold funds for next month | `month`, `categoryId` |
| `actual_budgets_resetHold` | Reset hold status | `month`, `categoryId` |

### Rules (4 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_rules_get` | List all rules | - |
| `actual_rules_create` | Create transaction rule | `conditions`, `actions` |
| `actual_rules_update` | Update rule | `id`, `conditions?`, `actions?` |
| `actual_rules_delete` | Delete rule | `id` |

### Batch Operations (1 tool)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_budget_updates_batch` | Batch multiple budget updates | `updates` (function) |

**Total: 39 tools across 8 categories**

---

## ✅ Allowed vs ❌ Not Allowed Operations

### ✅ What You CAN Do

#### Account Management
- ✅ **View** all accounts and balances
- ✅ **Create** checking, savings, credit card accounts
- ✅ **Update** account names and types
- ✅ **Close** accounts (soft delete - preserves history)
- ✅ **Reopen** previously closed accounts
- ✅ **Delete** accounts permanently (⚠️ destroys all transaction history)
- ✅ **Check balance** at any point in time

#### Transaction Management
- ✅ **View** transactions with date range filtering
- ✅ **Filter** transactions by amount, category, payee, notes, status
- ✅ **Search** transactions with advanced criteria
- ✅ **Create** single or multiple transactions
- ✅ **Import** bank CSV files (auto-reconciliation)
- ✅ **Update** transaction details (amount, payee, category, notes, date)
- ✅ **Delete** transactions
- ✅ **Split** transactions across multiple categories
- ✅ **Reconcile** with bank statements

#### Category & Budget Management
- ✅ **Create** category groups and categories
- ✅ **Organize** categories into groups
- ✅ **Set** monthly budget amounts
- ✅ **Transfer** budget amounts between categories
- ✅ **Enable** category carryover (rollover unused funds)
- ✅ **Hold** funds for next month
- ✅ **Batch update** multiple budget categories efficiently
- ✅ **View** budget vs actual spending

#### Payee Management
- ✅ **Create** and manage payees
- ✅ **Merge** duplicate payees
- ✅ **View** payee transaction history
- ✅ **Get** rules associated with payees

#### Automation & Rules
- ✅ **Create** automatic categorization rules
- ✅ **Set** conditions (payee name, amount, etc.)
- ✅ **Define** actions (assign category, rename, etc.)
- ✅ **Update** existing rules
- ✅ **Delete** rules

### ❌ What You CANNOT Do (Not Yet Implemented)

#### Advanced Queries
- ❌ **Custom SQL queries** via `runQuery()` API
- ❌ **Complex transaction filters** (multiple conditions)
- ❌ **Report generation** (spending reports, trend analysis)
- ❌ **Budget vs actual** comparisons (built-in reports)

#### Scheduled Transactions
- ❌ **Create** recurring/scheduled transactions
- ❌ **View** upcoming scheduled transactions
- ❌ **Modify** schedule patterns
- ❌ **Auto-post** scheduled transactions

#### Budget Templates
- ❌ **Apply** budget templates
- ❌ **Save** budget as template
- ❌ **Copy** budgets between months

#### Category Transfers
- ✅ **Transfer** funds between budget categories (same month)
- ❌ **Borrow** from future months

#### Notes & Attachments
- ❌ **Add** notes to transactions/accounts
- ❌ **Attach** files (receipts, invoices)
- ❌ **View** transaction attachments

#### Advanced Features
- ❌ **Multi-budget** support (only one budget per server instance)
- ❌ **Bulk operations** (mass delete, mass update - except batch budget updates)
- ❌ **Data export** (CSV/JSON export)
- ❌ **Undo/Redo** operations

### 🔜 Coming Soon (Planned Features)

- 🔄 **Scheduled Transactions**: Full support for recurring transactions
- 📊 **Custom Reports**: Generate spending analysis and trends
- 📁 **Bulk Operations**: Mass update/delete with filters
-  **Notes Support**: Add notes to transactions and accounts
- 🏷️ **Tags**: Tag-based transaction organization

---

## 📦 Installation

### Method 1: npm (Development)

```bash
# Clone repository
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Build TypeScript
npm run build

# Run server
npm run dev -- --debug --http
```

### Method 2: Docker (Recommended for Production)

```bash
# Pull image
docker pull ghcr.io/agigante80/actual-mcp-server:latest

# Create secrets directory
mkdir -p secrets
echo "your_password" > secrets/actual_password.txt
chmod 600 secrets/actual_password.txt

# Run container
docker run -d \
  --name actual-mcp-server \
  -p 3000:3000 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD_FILE=/run/secrets/actual_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -v $(pwd)/secrets/actual_password.txt:/run/secrets/actual_password:ro \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest
```

### Method 3: Docker Compose (Full Stack)

```bash
# Clone repository
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server

# Configure environment
cp .env.example .env
# Edit .env

# Start full stack (Actual Budget + MCP Server)
docker compose --profile fullstack --profile dev up -d

# Or production mode
mkdir -p secrets
echo "your_password" > secrets/actual_password.txt
docker compose --profile production up -d
```

---

## 💡 Usage Examples

### Example 1: Check Account Balances

```bash
# Using curl with HTTP transport
curl -X POST http://localhost:3000/http \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "actual_accounts_list",
      "arguments": {}
    }
  }'
```

### Example 2: Add Transaction

```bash
curl -X POST http://localhost:3000/http \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "actual_transactions_create",
      "arguments": {
        "accountId": "your-account-id",
        "date": "2025-11-09",
        "amount": -5000,
        "payee": "Amazon",
        "notes": "Office supplies"
      }
    }
  }'
```

**Note**: Amounts are in cents (integer). $50.00 = `5000`, expenses are negative.

### Example 3: Set Monthly Budget

```bash
curl -X POST http://localhost:3000/http \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "actual_budgets_setAmount",
      "arguments": {
        "month": "2025-11",
        "categoryId": "your-category-id",
        "amount": 50000
      }
    }
  }'
```

### Example 4: Using with LibreChat

1. Start the MCP server: `npm run dev -- --http`
2. Configure LibreChat to use MCP server at `http://localhost:3000`
3. In LibreChat, ask: **"What's my checking account balance?"**
4. LibreChat calls `actual_accounts_list` and `actual_accounts_get_balance`
5. You get a natural language response: "Your checking account balance is $1,234.56"

---

## ⚙️ Configuration

### Environment Variables

All configuration via environment variables. See [`.env.example`](.env.example) for full reference.

#### Required Settings

```bash
# Actual Budget Connection
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=abc123  # From Actual: Settings → Sync ID
```

#### Server Settings

```bash
# Port and host
MCP_BRIDGE_PORT=3000
MCP_BRIDGE_BIND_HOST=0.0.0.0

# Data directory
MCP_BRIDGE_DATA_DIR=./actual-data

# Transport endpoints
MCP_SSE_PATH=/sse
MCP_HTTP_PATH=/http
```

#### Logging

```bash
# Enable file logging
MCP_BRIDGE_STORE_LOGS=true
MCP_BRIDGE_LOG_DIR=./logs
MCP_BRIDGE_LOG_LEVEL=info  # error, warn, info, debug

# Log rotation
MCP_BRIDGE_MAX_FILES=14d
MCP_BRIDGE_MAX_LOG_SIZE=20m
```

#### Security

```bash
# Bearer token authentication (recommended for production)
MCP_SSE_AUTHORIZATION=your_random_token

# Use Docker secrets in production
ACTUAL_PASSWORD_FILE=/run/secrets/actual_password
```

---

## 🔌 Transports & Authentication

The MCP server supports **three transport protocols** with optional Bearer token authentication.

### Available Transports

| Transport | Type | LibreChat Support | Authentication | Recommended |
|-----------|------|-------------------|----------------|-------------|
| **HTTP** | `streamable-http` | ✅ Full support | ✅ Working | **✅ RECOMMENDED** |
| **SSE** | `sse` | ✅ Supported | ⚠️ Headers not sent by client | Use without auth |
| **WebSocket** | `ws` | ❌ Not supported | ✅ Implemented | For other clients |

### 1. HTTP Transport (Recommended)

**Best for:** Production deployments with LibreChat

```bash
# Start server with HTTP
npm run dev -- --http

# Or with authentication
MCP_SSE_AUTHORIZATION=your_token npm run dev -- --http
```

**LibreChat Configuration:**

```yaml
# librechat.yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "http://192.168.8.245:3600/http"
    headers:
      Authorization: "Bearer your_token_here"
    serverInstructions: true
```

**Features:**
- ✅ Full MCP protocol support via `@modelcontextprotocol/sdk`
- ✅ Bearer token authentication via headers
- ✅ All 39 tools load successfully in LibreChat
- ✅ Session management with `MCP-Session-Id` headers
- ✅ Production-ready and tested

### 2. SSE Transport

**Best for:** Development or non-authenticated environments

```bash
# Start server with SSE
npm run dev -- --sse
```

**LibreChat Configuration:**

```yaml
# librechat.yaml (without authentication)
mcpServers:
  actual-mcp:
    type: "sse"
    url: "http://192.168.8.245:3600/sse"
    serverInstructions: true
```

**Features:**
- ✅ Full MCP protocol support
- ✅ Server-side authentication implemented
- ⚠️ LibreChat SSE client doesn't send custom headers
- ✅ Works perfectly without authentication

**Known Limitation:** While the server supports Bearer token authentication for SSE, LibreChat's SSE client implementation does not send custom headers specified in the configuration. Use HTTP transport for authenticated deployments.

### 3. WebSocket Transport

**Best for:** Custom MCP clients (not LibreChat)

```bash
# Start server with WebSocket
npm run dev -- --ws
```

**Connection Examples:**

```javascript
// With Authorization header
const ws = new WebSocket('ws://localhost:3600', {
  headers: {
    'Authorization': 'Bearer your_token_here'
  }
});

// Or with token query parameter
const ws = new WebSocket('ws://localhost:3600?token=your_token_here');
```

**Features:**
- ✅ Bearer token authentication (header or query param)
- ✅ Connection rejected during handshake if unauthorized
- ✅ Efficient for real-time applications
- ❌ Not supported by LibreChat

### Authentication Configuration

#### Enable Authentication

Set the `MCP_SSE_AUTHORIZATION` environment variable:

```bash
# Generate a secure token
openssl rand -hex 32

# Add to .env
MCP_SSE_AUTHORIZATION=your_generated_token_here

# Restart server
npm run build
npm run dev -- --http
```

#### Authentication Behavior

When `MCP_SSE_AUTHORIZATION` is set:
- ✅ Server validates Bearer tokens on all requests
- ✅ Returns `401 Unauthorized` for missing/invalid tokens
- ✅ Logs all authentication attempts
- ✅ Optional - if not set, authentication is disabled

#### Security Best Practices

```bash
# ✅ DO: Use strong random tokens (32+ characters)
MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32)

# ✅ DO: Use HTTPS/WSS in production
ACTUAL_SERVER_URL=https://actual.yourdomain.com

# ✅ DO: Rotate tokens regularly
# ✅ DO: Use environment variables, never hardcode
# ✅ DO: Monitor authentication failures in logs

# ❌ DON'T: Use weak or predictable tokens
# ❌ DON'T: Commit tokens to version control
# ❌ DON'T: Share tokens between environments
```

### Testing Results

Comprehensive testing completed with LibreChat:

| Test Case | Result | Tools Loaded |
|-----------|--------|--------------|
| HTTP without auth | ✅ Success | 39 tools |
| HTTP with auth | ✅ Success | 39 tools |
| SSE without auth | ✅ Success | 39 tools |
| SSE with auth | ⚠️ Client limitation | 0 tools (headers not sent) |

**Conclusion:** Use **HTTP transport with Bearer token authentication** for secure production LibreChat deployments.

See [`docs/transport-testing-final-report.md`](docs/transport-testing-final-report.md) for detailed test results.

---

## 🐳 Docker Deployment

### Docker Hub

Pull from GitHub Container Registry:

```bash
docker pull ghcr.io/agigante80/actual-mcp-server:latest
```

### Production Deployment

```bash
# 1. Create secrets
mkdir -p secrets
echo "your_password" > secrets/actual_password.txt
chmod 600 secrets/actual_password.txt

# 2. Create environment file
cat > .env << EOF
ACTUAL_SERVER_URL=https://actual.yourdomain.com
ACTUAL_BUDGET_SYNC_ID=abc123
MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32)
EOF

# 3. Run with Docker Compose
docker compose --profile production up -d

# 4. Check logs
docker compose logs -f mcp-server-prod

# 5. Verify health
curl http://localhost:3000/health
```

### Kubernetes

See [`docs/deployment.md`](docs/deployment.md) for Kubernetes manifests with:
- Deployments with health checks
- Services and Ingress
- Secret management
- Resource limits
- Horizontal scaling

---

## 🏗️ Architecture

```
┌──────────────┐         ┌──────────────┐         ┌─────────────┐
│   LibreChat  │   MCP   │  MCP Server  │   REST  │   Actual    │
│  (AI Client) │◄────────┤  (37 Tools)  │◄────────┤   Budget    │
└──────────────┘         └──────────────┘         └─────────────┘
                                │
                                ▼
                         ┌──────────────┐
                         │   SQLite DB  │
                         │  (Cached)    │
                         └──────────────┘
```

### Tech Stack

- **Runtime**: Node.js 20 (Alpine Linux in Docker)
- **Language**: TypeScript 5.9 (ES2020 + ESM modules)
- **MCP SDK**: @modelcontextprotocol/sdk ^1.18.2
- **API Client**: @actual-app/api ^25.9.0
- **Validation**: Zod (runtime type checking + JSON Schema)
- **Transport**: Express (HTTP), ws (WebSocket), EventEmitter (SSE)
- **Logging**: Winston with daily rotation
- **Testing**: Playwright, unit tests, integration tests

### Key Design Patterns

- **Singleton**: Tool manager, logger, config
- **Adapter**: Wraps Actual API with retry/concurrency
- **Strategy**: Multiple transport implementations
- **Factory**: Dynamic tool loading and registration

See [`docs/architecture.md`](docs/architecture.md) for detailed architecture documentation.

---

## 📊 API Coverage

### Coverage by Category

| Category | Coverage | Tools | Status |
|----------|----------|-------|--------|
| **Accounts** | 100% | 7/7 | ✅ Complete |
| **Transactions** | 83% | 5/6 | ✅ Core features |
| **Categories** | 100% | 4/4 | ✅ Complete |
| **Category Groups** | 100% | 4/4 | ✅ Complete |
| **Payees** | 100% | 6/6 | ✅ Complete |
| **Budgets** | 75% | 6/8 | ⚠️ Missing transfers |
| **Rules** | 100% | 4/4 | ✅ Complete |
| **Batch** | 100% | 1/1 | ✅ Complete |

**Overall: 76% API Coverage (37/49 core API methods)**

### Not Yet Implemented

- ❌ Scheduled transactions (recurring payments)
- ❌ Advanced queries (`runQuery()`)
- ❌ Budget templates
- ❌ Category balance transfers
- ❌ Transaction notes/attachments
- ❌ Custom reports

See [`docs/api-coverage.md`](docs/api-coverage.md) for complete API documentation with examples.

---

## 🧪 Testing

### Run Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:adapter

# End-to-end tests
npm run test:e2e

# Test connection only
npm run dev -- --test-actual-connection

# Test all tools
npm run dev -- --test-actual-tools
```

### Test Coverage

- **Unit Tests**: >80% coverage
- **Integration Tests**: Core workflows tested
- **E2E Tests**: Playwright-based full-stack tests
- **Smoke Tests**: All 37 tools validated

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for:

- Development setup
- Code standards
- Testing requirements
- Pull request process
- Auto-merge workflow

### Quick Contribution Guide

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes and add tests
4. Commit: `git commit -m "feat: add new feature"`
5. Push: `git push origin feature/my-feature`
6. Open Pull Request

---

## 📚 Documentation

- **[Architecture](docs/architecture.md)**: System design and technical details
- **[API Coverage](docs/api-coverage.md)**: Complete tool reference with examples
- **[Deployment](docs/deployment.md)**: Docker, Kubernetes, bare metal guides
- **[Development](docs/development.md)**: Local development and debugging
- **[Transport Testing](docs/transport-testing-final-report.md)**: Complete transport and authentication test results
- **[SSE Authentication](docs/sse-authentication.md)**: SSE-specific authentication guide
- **[Contributing](CONTRIBUTING.md)**: Contribution guidelines and workflow

---

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[Actual Budget](https://actualbudget.org/)**: Open-source budgeting software
- **[Model Context Protocol](https://modelcontextprotocol.io/)**: Standardized AI-app integration
- **[LibreChat](https://github.com/danny-avila/LibreChat)**: Open-source ChatGPT alternative
- **Community contributors**: Thank you for your support!

---

## 📞 Support & Community

- **GitHub Issues**: [Report bugs or request features](https://github.com/agigante80/actual-mcp-server/issues)
- **GitHub Discussions**: [Ask questions and share ideas](https://github.com/agigante80/actual-mcp-server/discussions)
- **Documentation**: [Comprehensive guides in /docs](docs/)

---

**Made with ❤️ by the Actual MCP Server community**
