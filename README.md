# Actual MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.18-orange)](https://modelcontextprotocol.io/)

A production-ready **Model Context Protocol (MCP)** server that bridges AI assistants with [Actual Budget](https://actualbudget.org/), enabling natural language financial management through 39 specialized tools covering 78% of the Actual Budget API.

> **🧪 Tested with LibreChat**: This MCP server has been extensively tested and verified with [LibreChat](https://github.com/danny-avila/LibreChat) as the client. All 42 tools load and function correctly. Other MCP clients should work but have not been tested yet.

---

## 📋 Table of Contents

- [Use Cases & Scenarios](#-use-cases--scenarios)
- [Connection Architecture](#-connection-architecture)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Available Tools](#-available-tools)
- [Missing Tools](#-missing-tools-not-yet-implemented)
- [Installation](#-installation)
- [LibreChat Integration](#-librechat-integration)
- [Usage Examples](#-usage-examples)
- [Configuration](#-configuration)
- [Transports & Authentication](#-transports--authentication)
- [Docker Deployment](#-docker-deployment)
- [Architecture](#-architecture)
- [API Coverage](#-api-coverage)
- [Testing](#-testing)
- [Contributing](#-contributing)
- [Documentation](#-documentation)
- [License](#-license)

---

## 💡 Use Cases & Scenarios

### What Can You Do with This Integration?

**LibreChat ↔ Actual MCP Server ↔ Actual Budget**

This MCP server enables conversational financial management by connecting LibreChat's AI capabilities with your Actual Budget data. Here are real-world scenarios:

#### 🗣️ Natural Language Queries

```
You: "How much did I spend on groceries last month?"
AI: [Uses transactions_filter] "You spent $847.23 on groceries in October 2025"

You: "Show me all transactions over $100 this week"
AI: [Uses transactions_filter] Lists large transactions with dates and payees

You: "What's my checking account balance?"
AI: [Uses accounts_get_balance] "Your checking account has $3,247.89"
```

#### 💰 Budget Management

```
You: "Set my restaurant budget to $300 for this month"
AI: [Uses budgets_setAmount] "Restaurant budget for November 2025 set to $300"

You: "Transfer $50 from Entertainment to Groceries"
AI: [Uses budgets_transfer] "Transferred $50 from Entertainment to Groceries"

You: "How much budget do I have left for December?"
AI: [Uses budgets_getMonth] Shows remaining budget for all categories
```

#### 📝 Transaction Management

```
You: "Add a $45.67 transaction at Kroger from my checking account"
AI: [Uses transactions_create] "Transaction created and categorized as Groceries"

You: "Import my bank CSV file" [with file upload]
AI: [Uses transactions_import] "Imported 47 transactions, matched 12 duplicates"

You: "Find all Amazon transactions this year"
AI: [Uses transactions_filter] Lists all Amazon purchases with amounts
```

#### 🏷️ Organization & Automation

```
You: "Create a rule to automatically categorize Uber as Transportation"
AI: [Uses rules_create] "Rule created: Uber → Transportation"

You: "Merge my duplicate Starbucks payees"
AI: [Uses payees_merge] "Merged 3 Starbucks entries into one"

You: "Create a new category called 'Pet Supplies' under Expenses"
AI: [Uses categories_create] "Pet Supplies category created"
```

### 🎯 Perfect For

- **💬 Conversational Finance**: Chat with your budget naturally
- **📊 Quick Insights**: Get financial answers without opening Actual Budget
- **🔄 Bulk Operations**: Manage multiple transactions through conversation
- **🤖 Automation**: Set up rules and recurring patterns via AI
- **📱 Mobile-Friendly**: Use LibreChat mobile app for on-the-go budget access
- **♿ Accessibility**: Voice-based financial management for users with disabilities

---

## 🔗 Connection Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│             │  HTTPS  │                  │   API   │              │
│  LibreChat  │ ◄─────► │  Actual MCP      │ ◄─────► │   Actual     │
│   (Client)  │  MCP    │     Server       │  calls  │   Budget     │
│             │Protocol │                  │         │   Server     │
└─────────────┘         └──────────────────┘         └──────────────┘
      │                        │                           │
      │                        │                           │
   User asks              Translates                  Financial
  "How much               natural language            operations
  did I spend?"           to Actual API calls         & data storage
```

### How It Works

1. **User** chats with **LibreChat** in natural language
2. **LibreChat** sends MCP tool requests to **Actual MCP Server**
3. **Actual MCP Server** translates requests to **Actual Budget API** calls
4. **Actual Budget** executes operations and returns data
5. **Actual MCP Server** formats response for AI consumption
6. **LibreChat** presents results in conversational format

### Transport Protocols

- **HTTP/HTTPS**: Production-ready with Bearer token authentication (recommended)
- **SSE (Server-Sent Events)**: Streaming updates (LibreChat compatible)

---

## ✨ Features

### Core Capabilities
### Core Capabilities

- 🤖 **39 MCP Tools**: Comprehensive financial operations via natural language
- 🔄 **Multiple Transports**: HTTP and Server-Sent Events (SSE)
- 🔐 **Secure**: Bearer token authentication + HTTPS/TLS encryption
- 🛡️ **Type-Safe**: Full TypeScript implementation with runtime validation (Zod)
- 🔁 **Resilient**: Automatic retry logic with exponential backoff
- 📊 **78% API Coverage**: Supports majority of Actual Budget operations
- 🚀 **Production-Ready**: Docker support, structured logging, health checks
- ✅ **LibreChat Verified**: All 42 tools tested and working

### Advanced Features

- **Concurrent Control**: Rate-limited API calls prevent overwhelming Actual Budget
- **Observability**: Prometheus metrics, structured logging with Winston
- **Flexible Deployment**: Docker, Kubernetes, bare metal, or Docker Compose
- **HTTPS Support**: TLS encryption with self-signed or CA-signed certificates
- **Tested**: >80% test coverage with unit, integration, and E2E tests

### Financial Operations

With conversational AI, you can:

- 💰 **Manage Accounts**: Create, update, close accounts; check balances
- 💳 **Track Transactions**: Add, update, delete transactions; import bank data
- 📁 **Organize Categories**: Create category groups and categories
- 👥 **Handle Payees**: Manage payees, merge duplicates
- 📅 **Budget Planning**: Set budget amounts, enable carryover, track spending
- 🔧 **Automate Rules**: Create rules for automatic transaction categorization
- 🔄 **Batch Operations**: Efficiently update multiple budget categories

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

**Docker images are published on two registries:**

- **Docker Hub**: [agigante80/actual-mcp-server](https://hub.docker.com/r/agigante80/actual-mcp-server)
- **GitHub Container Registry**: [ghcr.io/agigante80/actual-mcp-server](https://github.com/agigante80/actual-mcp-server/pkgs/container/actual-mcp-server)

Available tags:
- `latest` - Latest stable release from main branch
- `latest-<sha>` - Specific commit from main (e.g., `latest-abc1234`)
- `development` - Latest development build
- `development-<sha>` - Specific development commit

Both registries have identical images. Use Docker Hub for public access, or GHCR for integration with GitHub workflows.

> **Note**: Docker images default to HTTP transport mode. To use SSE instead, set `MCP_TRANSPORT_MODE=--sse`.

#### Quick Start (HTTP)

```bash
# Pull and run from Docker Hub (HTTP is the default)
docker run -d \
  --name actual-mcp-server \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -v actual-mcp-data:/data \
  agigante80/actual-mcp-server:latest

# Or from GitHub Container Registry
docker run -d \
  --name actual-mcp-server \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest

# Check if running
curl http://localhost:3600/health
```

#### With HTTPS (Recommended)

```bash
# Generate self-signed certificate first
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -subj "/CN=your-server-ip" \
  -addext "subjectAltName=IP:your-server-ip,DNS:localhost"

# Run with HTTPS enabled
docker run -d \
  --name actual-mcp-server \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -e MCP_ENABLE_HTTPS=true \
  -e MCP_HTTPS_CERT=/app/certs/cert.pem \
  -e MCP_HTTPS_KEY=/app/certs/key.pem \
  -v actual-mcp-data:/data \
  -v $(pwd)/certs:/app/certs:ro \
  agigante80/actual-mcp-server:latest

# Verify HTTPS is working
curl -k https://localhost:3600/health
```

#### Pull Specific Version

```bash
# Latest stable from Docker Hub
docker pull agigante80/actual-mcp-server:latest

# Latest stable from GHCR
docker pull ghcr.io/agigante80/actual-mcp-server:latest

# Development version
docker pull agigante80/actual-mcp-server:development

# Specific commit
docker pull agigante80/actual-mcp-server:latest-abc1234
```

#### Using docker-compose.prod.yml

For production deployments, use the provided `docker-compose.prod.yml`:

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your Actual Budget server details

# Start using GHCR image
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop
docker-compose -f docker-compose.prod.yml down
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

The MCP server exposes **42 tools** organized into 9 categories. All tools follow the naming convention `actual_<category>_<action>`.

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

### Budgets (8 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_budgets_get_all` | List all available budget files | - |
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

### Advanced Query & Sync (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_query_run` | Execute custom ActualQL query | `query` |
| `actual_bank_sync` | Trigger bank sync (GoCardless/SimpleFIN) | `accountId?` |

### Batch Operations (1 tool)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_budget_updates_batch` | Batch multiple budget updates | `updates` (function) |

**Total: 42 tools across 9 categories**

---

## 🚧 Missing Tools (Not Yet Implemented)

The following Actual Budget API features are not yet exposed as MCP tools:

### Schedules (4 API methods available)
- `getSchedules()` - List all scheduled transactions
- `createSchedule()` - Create recurring transaction schedules
- `updateSchedule()` - Modify schedule parameters
- `deleteSchedule()` - Remove schedules

These methods require access to Actual's internal API and are not directly exported from the standard methods module.

### Additional Multi-Budget Tools
- `loadBudget()` - Switch between budgets
- `downloadBudget()` - Download budget from server
- `runImport()` - Create and populate new budgets

### Lookup Helper
- `getIDByName()` - Look up IDs by name for accounts/payees/categories/schedules

**Note**: Most core financial operations (accounts, transactions, budgets, categories, payees, rules) are fully implemented with 42 tools. The missing features represent specialized workflows requiring deeper API integration. Contributions welcome!

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

## 💬 LibreChat Integration

### Quick Setup

1. **Start the MCP Server** (with HTTPS recommended)
```bash
# Using Docker
docker run -d --name actual-mcp-server \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -e MCP_ENABLE_HTTPS=true \
  -v $(pwd)/certs:/app/certs:ro \
  ghcr.io/agigante80/actual-mcp-server:latest
```

2. **Configure LibreChat** (`librechat.yaml`)
```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "https://your-server-ip:3600/http"
    headers:
      Authorization: "Bearer YOUR_TOKEN_HERE"
    serverInstructions: true
```

3. **Restart LibreChat**
```bash
docker restart ai-librechat
```

### HTTPS Setup (Recommended for Security)

Bearer tokens are sent in HTTP headers and should be encrypted in transit.

#### Option 1: Self-Signed Certificate (Development)

```bash
# Generate certificate
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -subj "/CN=your-server-ip" \
  -addext "subjectAltName=IP:your-server-ip,DNS:localhost"

# Trust certificate in LibreChat (Alpine Linux)
docker cp certs/cert.pem ai-librechat:/tmp/mcp-server.crt
docker exec -u root ai-librechat sh -c "cat /tmp/mcp-server.crt >> /etc/ssl/certs/ca-certificates.crt"
docker restart ai-librechat
```

#### Option 2: CA-Signed Certificate (Production)

```bash
# Using Let's Encrypt (requires domain name)
sudo certbot certonly --standalone -d your-domain.com
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem certs/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem certs/key.pem
sudo chown $USER:$USER certs/*.pem
```

Update LibreChat to use domain:
```yaml
mcpServers:
  actual-mcp:
    url: "https://your-domain.com:3600/http"  # Use domain name
```

#### Option 3: Docker Network (No HTTPS Needed)

If both containers are on the same Docker network, you can use HTTP securely:

```yaml
# docker-compose.yml
networks:
  mcp-network:
    driver: bridge

services:
  librechat:
    networks:
      - mcp-network
  
  actual-mcp-server:
    networks:
      - mcp-network
```

LibreChat configuration:
```yaml
mcpServers:
  actual-mcp:
    url: "http://actual-mcp-server:3600/http"  # Container name
```

### Environment Variables

```bash
# Required
ACTUAL_SERVER_URL=http://your-actual-server:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your_sync_id

# Security (generate with: openssl rand -hex 32)
MCP_SSE_AUTHORIZATION=your_bearer_token_here

# Transport mode (Docker only - defaults to --http)
# Options: --http (recommended), --sse, --ws
MCP_TRANSPORT_MODE=--http

# HTTPS (optional but recommended)
MCP_ENABLE_HTTPS=true
MCP_HTTPS_CERT=/app/certs/cert.pem
MCP_HTTPS_KEY=/app/certs/key.pem

# Optional
MCP_BRIDGE_PORT=3600
MCP_BRIDGE_DATA_DIR=/data
```

### Verification

Test the connection:
```bash
# Health check
curl -k https://localhost:3600/health

# Should return: {"status":"ok","initialized":true}
```

In LibreChat, you should see:
- ✅ **42 tools loaded** in the MCP servers list
- ✅ All tools available with `actual_` prefix
- ✅ Natural language queries working

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

The MCP server supports **two transport protocols** with optional Bearer token authentication.

> **Docker Note**: When running in Docker, HTTP transport is the default. Override with `MCP_TRANSPORT_MODE` environment variable (`--http` or `--sse`). For local development, specify the transport mode using command-line flags.

### Available Transports

| Transport | Type | LibreChat Support | Authentication | Recommended |
|-----------|------|-------------------|----------------|-------------|
| **HTTP** | `streamable-http` | ✅ Full support | ✅ Working | **✅ RECOMMENDED** |
| **SSE** | `sse` | ✅ Supported | ⚠️ Headers not sent by client | Use without auth |

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
- ✅ All 42 tools load successfully in LibreChat
- ✅ Session management with `MCP-Session-Id` headers
- ✅ Production-ready and tested

### 2. SSE Transport (Alternative)

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

# ✅ DO: Use HTTPS in production
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
| HTTP without auth | ✅ Success | 42 tools |
| HTTP with auth | ✅ Success | 42 tools |
| SSE without auth | ✅ Success | 42 tools |
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
- **Transport**: Express (HTTP), EventEmitter (SSE)
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
