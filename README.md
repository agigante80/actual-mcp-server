# Actual MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.18-orange)](https://modelcontextprotocol.io/)
[![Docker Pulls](https://img.shields.io/docker/pulls/agigante80/actual-mcp-server)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![Docker Image Size](https://img.shields.io/docker/image-size/agigante80/actual-mcp-server/latest)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![GitHub Actions CI](https://github.com/agigante80/actual-mcp-server/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/agigante80/actual-mcp-server/actions)
[![GitHub stars](https://img.shields.io/github/stars/agigante80/actual-mcp-server?style=social)](https://github.com/agigante80/actual-mcp-server)

**Talk to your budget. Run it anywhere. Trust it in production.**

Actual MCP Server is a [Model Context Protocol](https://modelcontextprotocol.io/) server that connects any MCP-compatible AI assistant — [LibreChat](https://www.librechat.ai/), [LobeChat](https://lobehub.com/home), [Claude Desktop](https://claude.ai/download), and more — directly to your self-hosted [Actual Budget](https://actualbudget.org/) instance. Ask natural language questions, create transactions, analyse spending, and manage your entire budget without ever opening the Actual Budget UI.

```
┌─────────────┐   MCP/HTTP   ┌──────────────────┐   Actual API   ┌──────────────┐
│  AI Client  │ ◄──────────► │  Actual MCP      │ ◄───────────► │   Actual     │
│ (LibreChat, │              │  Server          │               │   Budget     │
│  LobeChat,  │              │  (62 tools)      │               │   Server     │
│  Claude     │              └──────────────────┘               └──────────────┘
│  Desktop…)  │
└─────────────┘
```

### Why this project?

Most Actual Budget MCP implementations are simple stdio bridges designed for single-user, local use with Claude Desktop. This project goes further:

- **62 tools — the most comprehensive coverage available.** Accounts, transactions, categories, payees, rules, budgets, batch operations, bank sync, and more. Covers 84% of the Actual Budget API.
- **HTTP transport, not stdio.** Runs as a real remote server accessible by any number of clients simultaneously — essential for LibreChat, LobeChat, or any web-based AI assistant.
- **6 exclusive ActualQL-powered tools.** Search and summarise transactions by month, amount, category, or payee using Actual Budget's native query engine. Aggregated results, no raw data dumped into the AI context window.
- **Multi-budget switching at runtime.** Configure multiple budget files and let the AI switch between them mid-conversation with `actual_budgets_switch`.
- **Multi-user ready with OIDC.** Secure every session with JWKS-validated JWTs and per-user budget ACLs — no shared tokens required.
- **Production-grade reliability.** Connection pooling (up to 15 concurrent sessions), automatic retry with exponential backoff, and a full test suite (unit + E2E + integration).

> **Verified working** with [LibreChat](https://www.librechat.ai/), [LobeChat](https://lobehub.com/home), and [Claude Desktop](https://claude.ai/download). All 62 tools tested end-to-end. Any MCP-compatible client should work.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Configuration](#configuration)
- [Multi-Budget Switching](#multi-budget-switching)
- [Transport & Authentication](#transport--authentication)
- [Testing](#testing)
- [Documentation](#documentation)
- [Comparison with Similar Projects](#comparison-with-similar-projects)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Quick Start

### Prerequisites

- [Actual Budget](https://actualbudget.org/) server running (local or remote)
- Your **Budget Sync ID**: Actual → Settings → Show Advanced Settings → Sync ID
- **Node.js 20+** (npm method) or **Docker**

### Option A — Docker (recommended)

```bash
docker run -d \
  --name actual-mcp-server-backend \
  -p 3600:3600 \
  # Use the same URL you type in your browser to open Actual Budget:
  #   http://localhost:5006          — if Actual Budget runs on the same machine
  #   http://192.168.1.50:5006       — if it runs on another machine on your network
  #   https://actual.yourdomain.com  — if you use a domain name
  #   http://actual:5006             — if both containers share a Docker network (use container name)
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=your_secret_token \
  -v actual-mcp-data:/data \        # required — see note below
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest
```

> **Why the `/data` volume is required:** Actual Budget does not expose a REST API. The official `@actual-app/api` library (used internally by this server) works by downloading a local copy of your budget data, running all queries on that local copy, then syncing changes back. The `/data` volume gives the container a persistent, writable place to store that local copy. Without it the container has nowhere to write and will fail on startup. See the [Actual API docs](https://actualbudget.org/docs/api/) for details.
>
> **actual-mcp does not need to run on the same machine as Actual Budget.** You can have Actual Budget on one server and actual-mcp on another - as long as `ACTUAL_SERVER_URL` points to your Actual Budget instance, everything works.

**Verify it's running:**

```bash
# Quick health check
curl http://localhost:3600/health
# Expected: {"status":"ok","transport":"http","version":"..."}

# Full MCP handshake (also verifies your token)
curl -s -X POST http://localhost:3600/http \
  -H "Authorization: Bearer your_secret_token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli-test","version":"1.0"}}}' \
  | python3 -m json.tool
# Success: JSON response with "protocolVersion" and "serverInfo"
# Wrong token: {"error": "Unauthorized"}
# Server not running: curl: (7) Failed to connect
```

Also available on Docker Hub: `agigante80/actual-mcp-server:latest`

### Option B — Docker Compose

```bash
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
cp .env.example .env        # fill in ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID

docker compose --profile production up -d   # Nginx proxy on :3600
# or
docker compose --profile dev up -d          # dev mode with hot-reload
# or
docker compose --profile fullstack up -d    # includes Actual Budget server on :5006
```

### Option C — npm

```bash
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
npm install
cp .env.example .env        # fill in required values
npm run build
npm run dev -- --http
```

Server starts at `http://localhost:3000/http` (dev) or `http://localhost:3600/http` (Docker).

### Connect an AI client

**LibreChat / LobeChat** — add to `librechat.yaml` (or LobeChat MCP plugin settings):

```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "http://actual-mcp-server-backend:3600/http"
    headers:
      Authorization: "Bearer YOUR_TOKEN_HERE"
    serverInstructions: true
    timeout: 600000
```

See [docs/guides/AI_CLIENT_SETUP.md](docs/guides/AI_CLIENT_SETUP.md) for full LibreChat, LobeChat, network, and HTTPS/TLS proxy setup.

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3600/http",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

See [docs/guides/CLAUDE_DESKTOP_SETUP.md](docs/guides/CLAUDE_DESKTOP_SETUP.md) for HTTPS setup, Linux/NVM fixes, and troubleshooting.

---

## Available Tools

**62 tools** across 12 categories. All tools use the `actual_<category>_<action>` naming convention.

### Accounts (7)

| Tool | Description |
|------|-------------|
| `actual_accounts_list` | List all accounts |
| `actual_accounts_create` | Create new account |
| `actual_accounts_update` | Update account details |
| `actual_accounts_delete` | Permanently delete account |
| `actual_accounts_close` | Close account (soft delete) |
| `actual_accounts_reopen` | Reopen closed account |
| `actual_accounts_get_balance` | Get account balance at a date |

### Transactions (12)

**Standard (6)**

| Tool | Description |
|------|-------------|
| `actual_transactions_get` | Get transactions for an account |
| `actual_transactions_filter` | Filter with advanced criteria |
| `actual_transactions_create` | Create new transaction(s) |
| `actual_transactions_import` | Import and reconcile transactions |
| `actual_transactions_update` | Update a transaction |
| `actual_transactions_delete` | Delete a transaction |

**Exclusive ActualQL-powered (6)** — unique to this MCP server

| Tool | Description |
|------|-------------|
| `actual_transactions_search_by_month` | Search by month using `$month` transform |
| `actual_transactions_search_by_amount` | Find by amount range |
| `actual_transactions_search_by_category` | Search by category name |
| `actual_transactions_search_by_payee` | Find by payee/vendor |
| `actual_transactions_summary_by_category` | Spending summary grouped by category |
| `actual_transactions_summary_by_payee` | Top vendors with totals and counts |

### Categories (4)

`actual_categories_get` · `actual_categories_create` · `actual_categories_update` · `actual_categories_delete`

### Category Groups (4)

`actual_category_groups_get` · `actual_category_groups_create` · `actual_category_groups_update` · `actual_category_groups_delete`

### Payees (6)

`actual_payees_get` · `actual_payees_create` · `actual_payees_update` · `actual_payees_delete` · `actual_payees_merge` · `actual_payee_rules_get`

### Budgets (10)

| Tool | Description |
|------|-------------|
| `actual_budgets_list_available` | List all configured budget files |
| `actual_budgets_switch` | Switch active budget (multi-budget) |
| `actual_budgets_get_all` | List available budget files |
| `actual_budgets_getMonths` | List budget months |
| `actual_budgets_getMonth` | Get budget for a specific month |
| `actual_budgets_setAmount` | Set category budget amount |
| `actual_budgets_transfer` | Transfer amount between categories |
| `actual_budgets_setCarryover` | Enable/disable carryover |
| `actual_budgets_holdForNextMonth` | Hold funds for next month |
| `actual_budgets_resetHold` | Reset hold status |

### Rules (4)

`actual_rules_get` · `actual_rules_create` · `actual_rules_update` · `actual_rules_delete`

### Advanced Query & Sync (2)

| Tool | Description |
|------|-------------|
| `actual_query_run` | Execute custom ActualQL query |
| `actual_bank_sync` | Trigger bank sync (GoCardless/SimpleFIN) |

### Batch Operations (1)

`actual_budget_updates_batch` — batch multiple budget updates in one call

### Server Information & Lookup (3)

| Tool | Description |
|------|-------------|
| `actual_server_info` | Server status, version, build info |
| `actual_server_get_version` | Actual Budget server version |
| `actual_get_id_by_name` | Resolve name → UUID for accounts, categories, payees |

### Session Management (2)

`actual_session_list` · `actual_session_close`

### Not Yet Implemented

- Scheduled/recurring transactions (`getSchedules`, `createSchedule`, `updateSchedule`, `deleteSchedule`)

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` to get started.

### Complete Environment Variables Reference

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| **Actual Budget Connection** ||||
| `ACTUAL_SERVER_URL` | `http://localhost:5006` | Yes | URL of your Actual Budget server. Use the same URL you type in your browser: `http://localhost:5006` (local), `http://192.168.1.x:5006` (network), `https://actual.yourdomain.com` (domain), or `http://actual:5006` (container name if on the same Docker network) |
| `ACTUAL_PASSWORD` | — | Yes | Password for Actual Budget server |
| `ACTUAL_BUDGET_SYNC_ID` | — | Yes | Budget Sync ID from Actual (Settings → Sync ID) |
| `ACTUAL_BUDGET_PASSWORD` | — | No | Optional encryption password for encrypted budgets |
| **MCP Server Settings** ||||
| `MCP_BRIDGE_PORT` | `3000` (dev) / `3600` (Docker) | No | Port for MCP server to listen on |
| `MCP_BRIDGE_BIND_HOST` | `0.0.0.0` | No | Host address to bind server to (`0.0.0.0` = all interfaces) |
| `MCP_BRIDGE_DATA_DIR` | `./actual-data` | No | Directory to store Actual Budget local data (SQLite). **Required to be a persistent path.** The `@actual-app/api` library downloads a local copy of your budget here to run queries — use a volume mount in Docker to persist it across restarts |
| `MCP_BRIDGE_PUBLIC_HOST` | auto-detected | No | Public hostname/IP for server (shown in logs) |
| `MCP_BRIDGE_PUBLIC_SCHEME` | auto-detected | No | Public scheme (`http` or `https`) |
| `MCP_BRIDGE_USE_TLS` | `false` | No | Set to `true` to advertise `https://` in the server URL (for reverse-proxy setups where TLS is terminated upstream) |
| **Transport Configuration** ||||
| `MCP_TRANSPORT_MODE` | `--http` | No | Transport mode (only `--http` supported) |
| `MCP_HTTP_PATH` | `/http` | No | HTTP endpoint routing path |
| `MCP_BRIDGE_HTTP_PATH` | same as `MCP_HTTP_PATH` | No | Advertised HTTP path shown to clients (set when a reverse proxy rewrites the path) |
| **Session Management** ||||
| `USE_CONNECTION_POOL` | `true` | No | Enable session-based connection pooling |
| `MAX_CONCURRENT_SESSIONS` | `15` | No | Maximum concurrent MCP sessions allowed |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `5` (pool) / `2` (HTTP) | No | Minutes before idle session cleanup |
| **Security & Authentication** ||||
| `AUTH_PROVIDER` | `none` | No | Auth mode: `none` (static Bearer) or `oidc` (JWKS-validated JWT) |
| `MCP_SSE_AUTHORIZATION` | — | No | Static Bearer token (`AUTH_PROVIDER=none`; highly recommended in production) |
| `OIDC_ISSUER` | — | If OIDC | OIDC issuer URL (e.g., `https://sso.example.com`) |
| `OIDC_RESOURCE` | — | No | Expected `aud` claim in JWT (your client ID) |
| `OIDC_SCOPES` | — | No | Comma-separated required scopes; leave empty for Casdoor |
| `AUTH_BUDGET_ACL` | — | No | Per-user budget ACL — see [AI Client Setup](docs/guides/AI_CLIENT_SETUP.md#oidc-authentication-multi-user) |
| `MCP_ENABLE_HTTPS` | `false` | No | Enable native TLS. Requires `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY` |
| `MCP_HTTPS_CERT` | — | No | Path to PEM certificate file (required when `MCP_ENABLE_HTTPS=true`) |
| `MCP_HTTPS_KEY` | — | No | Path to PEM private key file (required when `MCP_ENABLE_HTTPS=true`) |
| **Logging Configuration** ||||
| `MCP_BRIDGE_STORE_LOGS` | `false` | No | Enable file logging (vs console only) |
| `MCP_BRIDGE_LOG_DIR` | `./logs` | No | Directory for log files (if `STORE_LOGS=true`) |
| `MCP_BRIDGE_LOG_LEVEL` | `debug` | No | Log level: `error`, `warn`, `info`, `debug` |
| **Log Rotation** (when `MCP_BRIDGE_STORE_LOGS=true`) ||||
| `MCP_BRIDGE_MAX_FILES` | `14d` | No | Keep rotated logs for N days (e.g., `14d`, `30d`) |
| `MCP_BRIDGE_MAX_LOG_SIZE` | `20m` | No | Rotate when file reaches size (e.g., `20m`, `100m`) |
| `MCP_BRIDGE_ROTATE_DATEPATTERN` | `YYYY-MM-DD` | No | Date pattern for rotated log filenames |
| **Development & Debugging** ||||
| `DEBUG` | `false` | No | Enable debug mode (verbose logging) |
| `LOG_LEVEL` | `info` | No | Log level override: `error`, `warn`, `info`, `debug` |
| `MCP_BRIDGE_DEBUG_TRANSPORT` | `false` | No | Enable transport-level debug logging |
| **Advanced/Internal** ||||
| `ACTUAL_API_CONCURRENCY` | `5` | No | Max concurrent Actual API operations |
| `NODE_ENV` | `production` | No | Node environment; `production` hides stack traces in error responses |
| `VERSION` | auto-detected | No | Server version (auto-set by build/Docker) |
| `TZ` | `UTC` | No | Timezone for timestamps (e.g., `America/New_York`) |

---

## Multi-Budget Switching

Configure multiple Actual Budget files so the AI can switch between them at runtime using `actual_budgets_list_available` and `actual_budgets_switch`.

`BUDGET_N_SERVER_URL` and `BUDGET_N_PASSWORD` fall back to `ACTUAL_SERVER_URL` / `ACTUAL_PASSWORD` when omitted.

| Variable | Required | Fallback |
|----------|----------|---------|
| `BUDGET_DEFAULT_NAME` | No | `"Default"` |
| `BUDGET_N_NAME` | Yes (enables group) | — |
| `BUDGET_N_SYNC_ID` | Yes | — |
| `BUDGET_N_SERVER_URL` | No | `ACTUAL_SERVER_URL` |
| `BUDGET_N_PASSWORD` | No | `ACTUAL_PASSWORD` |
| `BUDGET_N_ENCRYPTION_PASSWORD` | No | — |

```bash
# Default budget
ACTUAL_SERVER_URL=http://actual:5006
ACTUAL_PASSWORD=my-password
ACTUAL_BUDGET_SYNC_ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
BUDGET_DEFAULT_NAME=Personal

# Budget 1 — same server, same password
BUDGET_1_NAME=Family
BUDGET_1_SYNC_ID=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

# Budget 2 — different server
BUDGET_2_NAME=Business
BUDGET_2_SERVER_URL=https://actual-office.example.com
BUDGET_2_PASSWORD=office-password
BUDGET_2_SYNC_ID=cccccccc-cccc-cccc-cccc-cccccccccccc
```

---

## Transport & Authentication

The server uses **HTTP transport** (`/http` endpoint) with optional Bearer token authentication.

### Static Bearer token (single-user)

```bash
# Generate a token
openssl rand -hex 32

# Add to .env
MCP_SSE_AUTHORIZATION=your_token_here
```

Clients send: `Authorization: Bearer your_token_here`

### OIDC (multi-user)

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://sso.yourdomain.com
OIDC_RESOURCE=your-client-id    # must match 'aud' JWT claim
OIDC_SCOPES=                    # leave empty for Casdoor
```

See [AI Client Setup — OIDC](docs/guides/AI_CLIENT_SETUP.md#oidc-authentication-multi-user) for `AUTH_BUDGET_ACL` format and Casdoor notes.

---

## Testing

| Command | What It Tests | Requires Live Server |
|---------|---------------|---------------------|
| `npm run build` | TypeScript compilation | No |
| `npm run test:unit-js` | 62-tool smoke, schema validation, auth ACL | No |
| `npm run test:adapter` | Adapter, retry logic, concurrency | No |
| `npm run test:e2e` | MCP protocol compliance (Playwright) | No |
| `npm run test:e2e:docker:full` | Full stack integration | Yes (Docker) |
| `npm run test:integration` | Live server sanity checks | Yes |
| `npm run test:integration:full` | Full live integration suite | Yes |

**Integration test levels** (`tests/manual/`): `sanity` → `smoke` → `normal` → `extended` → `full` → `cleanup`

See [`tests/manual/README.md`](tests/manual/README.md) and [`tests/e2e/README.md`](tests/e2e/README.md) for details.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/guides/CLAUDE_DESKTOP_SETUP.md](docs/guides/CLAUDE_DESKTOP_SETUP.md) | **Start here** — step-by-step guide to connecting Claude Desktop to Actual Budget |
| [docs/guides/AI_CLIENT_SETUP.md](docs/guides/AI_CLIENT_SETUP.md) | LibreChat & LobeChat setup, Docker networking, HTTPS/TLS proxy, OIDC |
| [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md) | Docker, Docker Compose profiles, production config, Kubernetes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component layers, data flow, transport protocols |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) | Auth models, threat model, hardening |
| [docs/TESTING_AND_RELIABILITY.md](docs/TESTING_AND_RELIABILITY.md) | Test strategy, coverage, reliability patterns |
| [docs/NEW_TOOL_CHECKLIST.md](docs/NEW_TOOL_CHECKLIST.md) | Step-by-step guide for adding a new MCP tool |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, code standards, PR process |
| [.env.example](.env.example) | Fully annotated environment variable reference |

---

## Comparison with Similar Projects

Several MCP servers exist for personal finance management. Here's how this project compares with the closest alternatives.

> **Snapshot date**: 2026-03-20. Versions and features reflect each project's latest release at that date.

### Feature Comparison

| Feature | **agigante80/actual-mcp-server** | [s-stefanov/actual-mcp](https://github.com/s-stefanov/actual-mcp) | [henfrydls/actual-budget-mcp](https://github.com/henfrydls/actual-budget-mcp) | [WGDevelopment/ynab-mcp-server](https://github.com/WGDevelopment/ynab-mcp-server) |
|---|---|---|---|---|
| **Version** | v0.4.26 | v1.11.1 | v0.2.0 | v0.1.0 |
| **Budget App** | Actual Budget (self-hosted) | Actual Budget (self-hosted) | Actual Budget (self-hosted) | YNAB (cloud, subscription) |
| **Language** | TypeScript / Node.js | TypeScript / Node.js | TypeScript / Node.js | Python |
| **Tool Count** | **62** | ~22 | 18 | 9 |
| **— Setup & Distribution —** |||||
| **Transport** | HTTP (Streamable HTTP) | STDIO + SSE option | STDIO | STDIO |
| **Docker support** | ✅ Full (image + Compose) | ✅ Image only | ❌ | ❌ |
| **Published package (npx/pip)** | ❌ Docker / clone only | ✅ `npx actual-mcp` | ✅ `npx actual-budget-mcp` | ✅ `pip install ynab-mcp` |
| **— Security & Access —** |||||
| **Authentication** | ✅ Bearer token + OIDC (JWKS) | ⚠️ Optional Bearer token | ❌ None (local only) | ✅ OS keyring / env var |
| **Read-only mode** | ❌ All tools always available | ✅ Write requires `--enable-write` flag | ❌ | ✅ Most tools are read-only |
| **Multi-budget switching** | ✅ Runtime switch via tool | ❌ | ❌ | ✅ (YNAB natively multi-budget) |
| **— Production & Reliability —** |||||
| **Connection pooling** | ✅ Up to 15 concurrent sessions | ❌ | ❌ | ❌ |
| **Retry / backoff** | ✅ 3 attempts, exponential backoff | ❌ | ❌ | ❌ |
| **Automated test suite** | ✅ Unit + E2E + integration | ❌ | ❌ | ❌ |
| **— Transactions —** |||||
| **Create / update / delete** | ✅ | ✅ | ✅ | ✅ |
| **Import & reconcile** | ✅ `actual_transactions_import` | ❌ | ❌ | ❌ |
| **Scheduled / recurring** | ❌ (planned) | ❌ | ❌ | ❌ |
| **— Analysis & Reporting —** |||||
| **ActualQL custom queries** | ✅ 6 exclusive tools + `actual_query_run` | ❌ | ❌ | N/A |
| **Summary by category / payee** | ✅ | ✅ spending-by-category | ✅ | ❌ |
| **Spending projections / forecast** | ❌ | ❌ | ✅ end-of-month forecast | ❌ |
| **Budget vs actual comparison** | ✅ via `actual_budgets_getMonth` | ❌ | ✅ dedicated tool | ✅ month summary |
| **Bank sync** | ✅ GoCardless / SimpleFIN | ❌ | ✅ | ❌ (YNAB handles sync natively) |
| **— Budget Management —** |||||
| **Set / transfer / carryover / hold** | ✅ Full (10 tools) | ❌ | ✅ Partial | ✅ Partial |
| **Batch budget updates** | ✅ `actual_budget_updates_batch` | ❌ | ❌ | ❌ |
| **— Accounts, Payees & Rules —** |||||
| **Account lifecycle (close/reopen)** | ✅ | ❌ | ❌ | N/A |
| **Payee merging** | ✅ `actual_payees_merge` | ❌ | ❌ | N/A |
| **Payee rules management** | ✅ Full CRUD | ✅ Full CRUD | ❌ | N/A |
| **— UX & Usability —** |||||
| **Natural language date parsing** | ❌ YYYY-MM-DD required | ❌ | ✅ "last month", "yesterday" | ❌ |
| **Bilingual support** | ❌ | ❌ | ✅ English + Spanish | ❌ |
| **Auto name → UUID resolution** | ⚠️ Explicit tool (`actual_get_id_by_name`) | ❌ | ✅ Automatic in all tools | ❌ |
| **AI prompt templates** | ❌ | ✅ financial-insights, budget-review | ❌ | ❌ |
| **Tested AI clients** | LibreChat, LobeChat | Claude Desktop, Codex | Claude Desktop, Cursor, VS Code | Claude Code |
| **License** | MIT | MIT | MIT | MIT |

### When to choose which project

- **This project** — best for production deployments, multi-user environments (OIDC), LibreChat/LobeChat, or when you need the broadest tool coverage and Docker-native setup.
- **s-stefanov/actual-mcp** — the original implementation; good for Claude Desktop with STDIO transport, AI-generated prompt templates, and built-in read-only mode.
- **henfrydls/actual-budget-mcp** — best for Spanish-speaking users, Cursor/VS Code integration, or when you want natural-language dates, automatic name resolution, and spending forecasts without any server setup.
- **WGDevelopment/ynab-mcp-server** — only option if you're a YNAB user; privacy-first design with OS keyring token storage and local-LLM focus.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and the PR process.

Quick flow:
1. Fork → `git checkout -b feature/my-feature`
2. Make changes + add tests
3. `npm run build && npm run test:unit-js` must pass
4. Open a Pull Request

---

## Architecture

- **Runtime**: Node.js 22 (Alpine Linux in Docker)
- **Language**: TypeScript 5.9 (ESM, NodeNext module resolution)
- **MCP SDK**: `@modelcontextprotocol/sdk` ^1.25.2
- **Actual API**: `@actual-app/api` ^26.3.0
- **Validation**: Zod (runtime types + JSON Schema for tool inputs)
- **Transport**: Express (HTTP)
- **Logging**: Winston with daily rotation

Every Actual API call goes through the `withActualApi()` wrapper in `src/lib/actual-adapter.ts`, which handles init/shutdown lifecycle, retry (3 attempts, exponential backoff), and concurrency limiting. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full design documentation.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- **[Actual Budget](https://actualbudget.org/)** — open-source budgeting software
- **[Model Context Protocol](https://modelcontextprotocol.io/)** — standardised AI-app integration
- **[LibreChat](https://github.com/danny-avila/LibreChat)** — open-source ChatGPT alternative
- **[s-stefanov/actual-mcp](https://github.com/s-stefanov/actual-mcp)** — original adapter pattern

---

## Disclaimer

This project started as a **personal learning exercise** to explore the [Model Context Protocol](https://modelcontextprotocol.io/) technology. It is an independent open-source project, not affiliated with, endorsed by, or supported by [Actual Budget](https://actualbudget.org/) or any other organisation.

The software is provided **as-is**, without warranty of any kind. The author accepts no responsibility for how it is used, for any data loss, financial errors, or other consequences arising from its use. If you connect it to real financial data, you do so entirely at your own risk.

---

## Support

- **[GitHub Issues](https://github.com/agigante80/actual-mcp-server/issues)** — bug reports and feature requests
- **[GitHub Discussions](https://github.com/agigante80/actual-mcp-server/discussions)** — questions and ideas

---

**Version:** 0.4.33 | **Tool Count:** 62 (verified LibreChat-compatible)
