# Actual MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.18-orange)](https://modelcontextprotocol.io/)
[![Docker Pulls](https://img.shields.io/docker/pulls/agigante80/actual-mcp-server)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![Docker Image Size](https://img.shields.io/docker/image-size/agigante80/actual-mcp-server/latest)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![GitHub Actions CI](https://github.com/agigante80/actual-mcp-server/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/agigante80/actual-mcp-server/actions)
[![GitHub stars](https://img.shields.io/github/stars/agigante80/actual-mcp-server?style=social)](https://github.com/agigante80/actual-mcp-server)

A production-ready **Model Context Protocol (MCP)** server that bridges AI assistants with [Actual Budget](https://actualbudget.org/), enabling natural language financial management through **53 specialized tools** covering 84% of the Actual Budget API, including **6 exclusive ActualQL-powered tools** designed specifically for this MCP server.

> **🧪 Tested with Multiple AI Clients**: This MCP server has been extensively tested and verified with both [LibreChat](https://www.librechat.ai/) and [LobeChat](https://lobehub.com/home). All 53 tools load and function correctly. Other MCP clients should work but have not been tested yet.

---

## 📋 Table of Contents

- [Use Cases & Scenarios](#-use-cases--scenarios)
- [Connection Architecture](#-connection-architecture)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Available Tools](#-available-tools)
- [Missing Tools](#-missing-tools-not-yet-implemented)
- [Installation](#-installation)
- [AI Client Integration (LibreChat & LobeChat)](#-ai-client-integration-librechat--lobechat)
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

- **HTTP/HTTPS**: Production-ready with Bearer token authentication

### 🐳 Docker Networking Best Practices

**For Docker-to-Docker communication (LibreChat, LobeChat, etc.)**, use internal Docker hostnames instead of host IPs:

✅ **RECOMMENDED**: `http://actual-mcp-server-backend:3600/http`  
❌ **NOT RECOMMENDED**: `http://192.168.x.x:3600/http`

**Why internal hostnames are better:**
- **Direct communication**: No extra network hops through host bridge
- **Better security**: No external network exposure required
- **Built-in DNS**: Automatic hostname resolution within Docker networks
- **Resilient**: Works even if host IP changes
- **Performance**: Lower latency for container-to-container communication

**Example configuration for AI clients:**
```yaml
# LibreChat librechat.yaml
mcpServers:
  actual-mcp:
    url: "http://actual-mcp-server-backend:3600/http"  # ✅ Use container name

# LobeChat (via UI)
Server URL: http://actual-mcp-server-backend:3600/http  # ✅ Use container name
```

Both containers must be on the same Docker network. See [Docker Deployment](#-docker-deployment) section below for network configuration.

---

## ✨ Features

### Core Capabilities
### Core Capabilities

- 🤖 **53 MCP Tools**: Comprehensive financial operations via natural language
-  **Secure**: Bearer token authentication + HTTPS/TLS encryption
- 🛡️ **Type-Safe**: Full TypeScript implementation with runtime validation (Zod)
- 🔁 **Resilient**: Automatic retry logic with exponential backoff
- 📊 **84% API Coverage**: Supports majority of Actual Budget operations
- 🚀 **Production-Ready**: Docker support, structured logging, health checks
- ✅ **LibreChat Verified**: All 53 tools tested and working
- ⚡ **Exclusive Tools**: 6 ActualQL-powered tools for advanced queries and summaries

### Advanced Features

- **Concurrent Control**: Rate-limited API calls prevent overwhelming Actual Budget
- **Observability**: Prometheus metrics, structured logging with Winston
- **Flexible Deployment**: Docker, Kubernetes, bare metal, or Docker Compose
- **HTTPS Support**: TLS encryption with self-signed or CA-signed certificates
- **Tested**: Unit tests (53 tools + schema), Playwright E2E, and live integration suite

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

> 🐳 **Docker Images Available**: 
> - **Docker Hub**: [`agigante80/actual-mcp-server`](https://hub.docker.com/r/agigante80/actual-mcp-server)
> - **GitHub Container Registry**: [`ghcr.io/agigante80/actual-mcp-server`](https://github.com/agigante80/actual-mcp-server/pkgs/container/actual-mcp-server)

### Prerequisites

- **Node.js 20+** or **Docker**
- **Actual Budget server** (running locally or hosted)
- Actual Budget credentials (password and sync ID)

### ⚠️ Critical: Zod Version Constraint

**This project MUST use Zod 3.x (3.25.76).** Do NOT upgrade to Zod 4.x!

Zod 4.x has breaking internal changes that cause `zod-to-json-schema` to produce incomplete schemas, breaking LibreChat tool validation. All 53 tools become invisible if Zod 4.x is used.

- **Reject any Dependabot/Renovate PRs** suggesting Zod 4.x
- The project includes safeguards: `package.json` overrides and Dockerfile post-install
- See `docs/ZOD_VERSION_CONSTRAINT.md` for technical details

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

> **Note**: Docker images use HTTP transport mode.

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

#### Using docker-compose.yaml (Production profile)

For production deployments, use the `production` profile in the provided `docker-compose.yaml`:

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your Actual Budget server details

# Start production stack (Nginx proxy + MCP server)
docker compose --profile production up -d

# View logs
docker compose --profile production logs -f

# Stop
docker compose --profile production down
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

The MCP server exposes **53 tools** organized into 12 categories. All tools follow the naming convention `actual_<category>_<action>`.

> **⚡ Exclusive ActualQL Tools**: This MCP server includes 6 specialized tools powered by ActualQL that are **unique to this implementation** and not available in standard Actual Budget integrations. These tools provide advanced querying, aggregation, and analysis capabilities.

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

### Transactions (12 tools)

**Basic Operations (6 tools)**

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_transactions_get` | Get transactions for account | `accountId`, `startDate?`, `endDate?` |
| `actual_transactions_filter` | Filter transactions with advanced criteria | `accountId?`, `startDate?`, `endDate?`, `minAmount?`, `maxAmount?`, `categoryId?`, `payeeId?`, `notes?`, `cleared?`, `reconciled?` |
| `actual_transactions_create` | Create new transaction(s) | `accountId`, `date`, `amount`, `payee?`, `category?`, `notes?` |
| `actual_transactions_import` | Import and reconcile transactions | `accountId`, `transactions[]` |
| `actual_transactions_update` | Update transaction | `id`, `amount?`, `payee?`, `category?`, `notes?`, `date?` |
| `actual_transactions_delete` | Delete transaction | `id` |

**⚡ Exclusive ActualQL-Powered Tools (6 tools)** - *Only available in this MCP server*

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_transactions_search_by_month` | Search transactions by month using `$month` transform | `month?` (YYYY-MM, defaults to current), `accountId?`, `categoryName?`, `payeeName?`, `minAmount?`, `maxAmount?` |
| `actual_transactions_search_by_amount` | Find transactions by amount range | `minAmount?`, `maxAmount?`, `startDate?`, `endDate?`, `accountId?`, `categoryName?`, `limit?` |
| `actual_transactions_search_by_category` | Search transactions by category name | `categoryName?`, `startDate?`, `endDate?`, `accountId?`, `minAmount?`, `maxAmount?`, `limit?` |
| `actual_transactions_search_by_payee` | Find transactions by payee/vendor | `payeeName?`, `startDate?`, `endDate?`, `accountId?`, `categoryName?`, `minAmount?`, `maxAmount?`, `limit?` |
| `actual_transactions_summary_by_category` | Get spending summary grouped by category with aggregation | `startDate?` (defaults to month start), `endDate?` (defaults to today), `accountId?`, `includeIncome?` |
| `actual_transactions_summary_by_payee` | Analyze top vendors/merchants with totals and counts | `startDate?` (defaults to month start), `endDate?` (defaults to today), `accountId?`, `limit?` |

These exclusive tools use ActualQL's advanced features like `$transform`, `groupBy`, `$sum`, and `$count` for efficient queries and aggregations that go beyond standard API capabilities.

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
| `actual_payees_update` | Update payee | `id`, `name?`, `category?` |
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
| `actual_budgets_holdForNextMonth` | Hold funds for next month | `month`, `amount` |
| `actual_budgets_resetHold` | Reset hold status | `month` |

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

### Server Information & Lookup (3 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_server_info` | Get MCP server status, version and build info | - |
| `actual_server_get_version` | Get Actual Budget server version | - |
| `actual_get_id_by_name` | Resolve entity name → UUID for accounts, categories, payees, or schedules | `type` (`accounts`\|`categories`\|`payees`\|`schedules`), `name` |

### Session Management (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `actual_session_list` | List all active MCP sessions | - |
| `actual_session_close` | Close a specific MCP session | `sessionId` |

**Total: 53 tools across 12 categories** (including 6 exclusive ActualQL-powered tools)

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

**Note**: Most core financial operations (accounts, transactions, budgets, categories, payees, rules) are fully implemented with 53 tools. The missing features represent specialized workflows requiring deeper API integration. Contributions welcome!

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

## 💬 AI Client Integration (LibreChat & LobeChat)

This MCP server has been tested and verified with both [LibreChat](https://www.librechat.ai/) and [LobeChat](https://lobehub.com/home). All 53 tools work correctly with both clients.

### Quick Setup (Docker Environment)

**⚠️ Important for Docker Deployments**: Always use **internal Docker hostnames** (not host IPs) for container-to-container communication. This provides better performance, security, and reliability.

✅ **CORRECT**: `http://actual-mcp-server-backend:3600/http`  
❌ **AVOID**: `http://192.168.x.x:3600/http`

#### 1. Start the MCP Server

```bash
# Using Docker Compose (recommended)
docker compose up -d mcp-server

# Or standalone Docker
docker run -d --name actual-mcp-server-backend \
  --network your-ai-network \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest
```

#### 2a. Configure LibreChat

Edit your `librechat.yaml`:

```yaml
# librechat.yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    # ✅ Use container name (not IP) if on same Docker network
    url: "http://actual-mcp-server-backend:3600/http"
    headers:
      Authorization: "Bearer YOUR_TOKEN_HERE"
    serverInstructions: true
    timeout: 600000  # 10 minutes
```

Then restart LibreChat:
```bash
docker restart ai-librechat
```

#### 2b. Configure LobeChat

In LobeChat UI:
1. Navigate to **Settings** → **Language Model** → **Model Context Protocol**
2. Click **Add Plugin**
3. Fill in the configuration:
   - **Name**: Actual Budget MCP
   - **Server Type**: HTTP
   - **Server URL**: `http://actual-mcp-server-backend:3600/http` ✅ (use container name)
   - **Authorization**: `Bearer YOUR_TOKEN_HERE`
4. Click **Save**

LobeChat will automatically discover all 53 tools.

### Network Configuration

Both the MCP server and AI client containers must be on the same Docker network:

```yaml
# docker-compose.yml
networks:
  ai-network:
    driver: bridge

services:
  librechat:  # or lobe-chat
    networks:
      - ai-network
  
  actual-mcp-server-backend:
    networks:
      - ai-network
```

Verify connectivity:
```bash
# From LibreChat/LobeChat container
docker exec <ai-container> wget -qO- http://actual-mcp-server-backend:3600/health
# Should return: {"status":"ok","initialized":true,...}
```

### HTTPS Setup (Optional - For External Access)

**Note**: HTTPS is **not required** when using internal Docker networking. Use HTTPS only if:
- Accessing MCP server from outside the Docker network
- Exposing server to the internet
- Compliance requirements mandate encryption

For internal Docker-to-Docker communication, HTTP is secure and simpler.

#### Option 1: Docker Internal Network (Recommended - No HTTPS Needed)

If both containers are on the same Docker network, use HTTP securely without TLS overhead:

```yaml
# docker-compose.yml
networks:
  ai-network:
    driver: bridge

services:
  librechat:  # or lobe-chat
    networks:
      - ai-network
  
  actual-mcp-server-backend:
    networks:
      - ai-network
```

Configuration:
```yaml
# LibreChat librechat.yaml
mcpServers:
  actual-mcp:
    url: "http://actual-mcp-server-backend:3600/http"  # ✅ No HTTPS needed
    
# LobeChat UI
Server URL: http://actual-mcp-server-backend:3600/http  # ✅ No HTTPS needed
```

Benefits: No certificate management, simpler configuration, same security (network isolation).

#### Option 2: Self-Signed Certificate (Development/External Access)

For testing HTTPS or external access:

```bash
# Generate certificate
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -subj "/CN=your-server-ip" \
  -addext "subjectAltName=IP:your-server-ip,DNS:localhost"

# Run MCP server with HTTPS
docker run -d --name actual-mcp-server-backend \
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
  ghcr.io/agigante80/actual-mcp-server:latest

# Trust certificate in LibreChat (Alpine Linux)
docker cp certs/cert.pem ai-librechat:/tmp/mcp-server.crt
docker exec -u root ai-librechat sh -c "cat /tmp/mcp-server.crt >> /etc/ssl/certs/ca-certificates.crt"
docker restart ai-librechat
```

#### Option 3: CA-Signed Certificate (Production/Internet-Facing)

```bash
# Using Let's Encrypt (requires domain name)
sudo certbot certonly --standalone -d your-domain.com
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem certs/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem certs/key.pem
sudo chown $USER:$USER certs/*.pem
```

Update AI client to use domain:
```yaml
# LibreChat librechat.yaml
mcpServers:
  actual-mcp:
    url: "https://your-domain.com:3600/http"  # Use domain name
    
# LobeChat UI
Server URL: https://your-domain.com:3600/http
```

### Verification

Test the connection:
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your_sync_id

# Security (generate with: openssl rand -hex 32)
MCP_SSE_AUTHORIZATION=your_bearer_token_here

# Transport mode (Docker only)
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
# Health check (adjust URL based on your setup)
curl http://localhost:3600/health
# Or with HTTPS
curl -k https://localhost:3600/health

# Should return: {"status":"ok","initialized":true,...}
```

In your AI client, you should see:
- ✅ **53 tools loaded** in the MCP servers list
- ✅ All tools available with `actual_` prefix
- ✅ Natural language queries working

**Note**: Tool count updated from 49 to 51 to reflect current implementation.

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

### Example 4: Using with AI Clients (LibreChat/LobeChat)

1. Start the MCP server: `npm run dev -- --http` (or use Docker)
2. Configure your AI client to connect:
   - **LibreChat**: Edit `librechat.yaml` with MCP server URL
   - **LobeChat**: Add plugin via Settings → Model Context Protocol
3. Ask natural language questions: **"What's my checking account balance?"**
4. AI client calls appropriate tools (`actual_accounts_list`, `actual_accounts_get_balance`)
5. You get conversational responses: "Your checking account balance is $1,234.56"

Both LibreChat and LobeChat work identically - all 53 tools are available for conversational financial management.

---

## ⚙️ Configuration

### Environment Variables

All configuration is managed via environment variables. See [`.env.example`](.env.example) for a complete reference with detailed descriptions.

#### Complete Environment Variables Reference

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| **Actual Budget Connection** ||||
| `ACTUAL_SERVER_URL` | `http://localhost:5006` | ✅ Yes | URL of your Actual Budget server |
| `ACTUAL_PASSWORD` | - | ✅ Yes | Password for Actual Budget server |
| `ACTUAL_BUDGET_SYNC_ID` | - | ✅ Yes | Budget Sync ID from Actual (Settings → Sync ID) |
| `ACTUAL_BUDGET_PASSWORD` | - | ❌ No | Optional encryption password for encrypted budgets |
| **MCP Server Settings** ||||
| `MCP_BRIDGE_PORT` | `3000` (dev)<br/>`3600` (Docker) | ❌ No | Port for MCP server to listen on |
| `MCP_BRIDGE_BIND_HOST` | `0.0.0.0` | ❌ No | Host address to bind server to (`0.0.0.0` = all interfaces) |
| `MCP_BRIDGE_DATA_DIR` | `./actual-data` | ❌ No | Directory to store Actual Budget local data (SQLite) |
| `MCP_BRIDGE_PUBLIC_HOST` | auto-detected | ❌ No | Public hostname/IP for server (shown in logs) |
| `MCP_BRIDGE_PUBLIC_SCHEME` | auto-detected | ❌ No | Public scheme (`http` or `https`) |
| `MCP_BRIDGE_USE_TLS` | `false` | ❌ No | Legacy TLS flag (use `MCP_ENABLE_HTTPS` instead) |
| `MCP_BRIDGE_ADVERTISED_URL` | - | ❌ No | Human-friendly URL displayed to users |
| **Transport Configuration** ||||
| `MCP_TRANSPORT_MODE` | `--http` | ❌ No | Transport mode (only `--http` supported) - Docker only |
| `MCP_HTTP_PATH` | `/http` | ❌ No | HTTP endpoint path |
| **Session Management** ||||
| `USE_CONNECTION_POOL` | `true` | ❌ No | Enable session-based connection pooling |
| `MAX_CONCURRENT_SESSIONS` | `15` | ❌ No | Maximum concurrent MCP sessions allowed |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `5` (pool)<br/>`2` (HTTP) | ❌ No | Minutes before idle session cleanup |
| **Security & Authentication** ||||
| `MCP_SSE_AUTHORIZATION` | - | ❌ No | Bearer token for authentication (highly recommended) |
| `MCP_ENABLE_HTTPS` | `false` | ❌ No | Enable HTTPS/TLS encryption |
| `MCP_HTTPS_CERT` | - | ⚠️ If HTTPS | Path to TLS certificate file (PEM format) |
| `MCP_HTTPS_KEY` | - | ⚠️ If HTTPS | Path to TLS private key file (PEM format) |
| `ACTUAL_PASSWORD_FILE` | - | ❌ No | Path to file containing password (Docker secrets) |
| **Logging Configuration** ||||
| `MCP_BRIDGE_STORE_LOGS` | `false` | ❌ No | Enable file logging (vs console only) |
| `MCP_BRIDGE_LOG_DIR` | `./logs` | ❌ No | Directory for log files (if `STORE_LOGS=true`) |
| `MCP_BRIDGE_LOG_LEVEL` | `info` | ❌ No | Log level: `error`, `warn`, `info`, `debug` |
| `LOG_LEVEL` | `info` | ❌ No | Alternative log level variable (overrides default) |
| `MCP_BRIDGE_DEBUG_TRANSPORT` | `false` | ❌ No | Enable transport-level debug logging |
| **Log Rotation** (when `MCP_BRIDGE_STORE_LOGS=true`) ||||
| `MCP_BRIDGE_MAX_FILES` | `14d` | ❌ No | Keep rotated logs for N days (e.g., `14d`, `30d`) |
| `MCP_BRIDGE_MAX_LOG_SIZE` | `20m` | ❌ No | Rotate when file reaches size (e.g., `20m`, `100m`) |
| `MCP_BRIDGE_COMPRESS_AFTER_HOURS` | `24` | ❌ No | Compress logs older than N hours |
| `MCP_BRIDGE_ROTATE_DATEPATTERN` | `YYYY-MM-DD` | ❌ No | Date pattern for rotated log filenames |
| **Development & Testing** ||||
| `DEBUG` | `false` | ❌ No | Enable debug mode (verbose logging) |
| `SKIP_BUDGET_DOWNLOAD` | `false` | ❌ No | Skip budget sync on startup (testing) |
| `TEST_ACTUAL_CONNECTION` | `false` | ❌ No | Test connection only and exit |
| `TEST_ACTUAL_TOOLS` | `false` | ❌ No | Run all tools test and exit |
| `USE_TEST_DATA` | `false` | ❌ No | Use mock data instead of real Actual server |
| **Advanced/Internal** ||||
| `ACTUAL_API_CONCURRENCY` | `5` | ❌ No | Max concurrent Actual API operations |
| `VERSION` | auto-detected | ❌ No | Server version (auto-set by build/Docker) |
| `ENABLE_METRICS` | `false` | ❌ No | Enable Prometheus metrics endpoint |
| `METRICS_PORT` | `9090` | ❌ No | Port for metrics endpoint |
| `TZ` | `UTC` | ❌ No | Timezone for timestamps (e.g., `America/New_York`) |

#### Quick Start Configuration

**Minimum required variables** to get started:

```bash
# .env file
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=abc123
```

**Recommended production configuration:**

```bash
# Required
ACTUAL_SERVER_URL=https://actual.yourdomain.com
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=abc123

# Security (generate token: openssl rand -hex 32)
MCP_SSE_AUTHORIZATION=your_secure_random_token

# HTTPS
MCP_ENABLE_HTTPS=true
MCP_HTTPS_CERT=/path/to/cert.pem
MCP_HTTPS_KEY=/path/to/key.pem

# Logging
MCP_BRIDGE_STORE_LOGS=true
MCP_BRIDGE_LOG_LEVEL=info

# Session Management
MAX_CONCURRENT_SESSIONS=15
SESSION_IDLE_TIMEOUT_MINUTES=5
```

**Docker-specific settings:**

Docker images use these defaults (can be overridden):
- `MCP_BRIDGE_PORT=3600` (instead of 3000)
- `MCP_TRANSPORT_MODE=--http`
- `MCP_BRIDGE_DATA_DIR=/data` (recommended for volume mount)

---

## 🔌 Transport & Authentication

The MCP server uses **HTTP transport** with optional Bearer token authentication.

### HTTP Transport

**Best for:** All deployments (only transport supported)

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
    url: "http://your-server-ip:3600/http"
    headers:
      Authorization: "Bearer your_token_here"
    serverInstructions: true
```

**Features:**
- ✅ Full MCP protocol support via `@modelcontextprotocol/sdk`
- ✅ Bearer token authentication via headers
- ✅ All 53 tools load successfully in LibreChat
- ✅ Session management with `MCP-Session-Id` headers
- ✅ Production-ready and tested

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

| Test Case | Result | Tools Loaded |
|-----------|--------|--------------|
| HTTP without auth | ✅ Success | 53 tools |
| HTTP with auth | ✅ Success | 53 tools |

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
│  (AI Client) │◄────────┤  (53 Tools)  │◄────────┤   Budget    │
│              │         │  +6 Exclusive│         │             │
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
- **MCP SDK**: @modelcontextprotocol/sdk ^1.25.2
- **API Client**: @actual-app/api ^26.2.1
- **Validation**: Zod (runtime type checking + JSON Schema)
- **Transport**: Express (HTTP)
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
| **Transactions** | 100% | 12/12 | ✅ Complete + 6 exclusive ActualQL tools |
| **Categories** | 100% | 4/4 | ✅ Complete |
| **Category Groups** | 100% | 4/4 | ✅ Complete |
| **Payees** | 100% | 6/6 | ✅ Complete |
| **Budgets** | 100% | 8/8 | ✅ Complete |
| **Rules** | 100% | 4/4 | ✅ Complete |
| **Query & Sync** | 100% | 2/2 | ✅ Complete |
| **Batch** | 100% | 1/1 | ✅ Complete |
| **Server Info & Lookup** | 100% | 3/3 | ✅ Complete |

**Overall: 84% API Coverage (53 tools covering all major Actual Budget operations)**

**⚡ Exclusive Features**: This MCP server includes 6 ActualQL-powered tools that provide advanced querying and aggregation capabilities not available in other Actual Budget integrations.

### Not Yet Implemented

- ❌ Scheduled transactions (recurring payments)
- ❌ Budget templates
- ❌ Transaction notes/attachments

**Note**: The `actual_query_run` tool provides direct ActualQL access for advanced custom queries beyond the 53 pre-built tools.
- ❌ Custom reports

See [`docs/api-coverage.md`](docs/api-coverage.md) for complete API documentation with examples.

---

## 🧪 Testing

### Quick Test Commands

```bash
# Run all tests (adapter + unit + Docker E2E)
npm run test:all

# Run protocol tests only (fast)
npm run test:e2e

# Run Docker integration tests (full stack)
npm run test:e2e:docker
```

### Test Types

| Command | What It Tests | Speed | Requires Docker |
|---------|---------------|-------|-----------------|
| `test:adapter` | Adapter layer, retry logic, concurrency | ⚡ 30s | No |
| `test:unit-js` | Unit tests (schema, 53-tool smoke, negative-path) | ⚡ 5s | No |
| `test:e2e` | MCP protocol compliance | ⚡ 10s | No |
| `test:e2e:docker` | Full stack integration | 🐢 60s | Yes |
| `test:all` | All of the above | 🐢 90s | Yes |

### Integration Tests (Live Server)

The `tests/manual/` suite connects to a **running MCP server** over HTTP and exercises the full JSON-RPC protocol — no mocking. Six test levels cascade upward:

| Level | Writes? | What runs |
|-------|---------|----------|
| `sanity` | No | Protocol checks: tool count, server info, SQL, GraphQL rejection |
| `smoke` | No | Sanity + account balances, categories, recent transactions |
| `normal` | Yes | Account lifecycle (create → update → close → reopen) |
| `extended` | Yes | Normal + category groups, categories, payees, transactions |
| `full` | Yes | Extended + budgets, rules, batch operations, advanced queries |
| `cleanup` | Yes | Finds and removes all `MCP-Test-*` / `MCP-Cat-*` / `MCP-Group-*` / `MCP-Payee-*` data |

```bash
# Via npm scripts
npm run test:integration              # sanity (default)
npm run test:integration:full        # full test run
npm run test:integration:cleanup     # delete all test data

# Direct invocation
node tests/manual/index.js [MCP_URL] [TOKEN] [LEVEL] [CLEANUP]
# Example:
node tests/manual/index.js http://localhost:3600/http mytoken full yes
```

See [`tests/manual/README.md`](tests/manual/README.md) for complete documentation.

### Docker E2E Tests

The Docker E2E tests provide comprehensive full-stack validation:

```bash
# Run Docker-based integration tests
npm run test:e2e:docker

# Advanced options
./tests/e2e/run-docker-e2e.sh --no-cleanup   # Leave containers for debugging
./tests/e2e/run-docker-e2e.sh --verbose      # Show detailed output
```

**What's tested:**
- ✅ Docker build correctness
- ✅ Container networking
- ✅ Real Actual Budget integration (all 53 tools)
- ✅ Session management
- ✅ Production deployment scenario

See [docs/DOCKER_E2E_TESTING.md](docs/DOCKER_E2E_TESTING.md) for complete documentation.

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
