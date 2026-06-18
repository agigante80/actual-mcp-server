<p align="center">
  <img src="unraid/actual-mcp-icon.png" alt="Actual MCP Server icon" width="128" height="128">
</p>

<h1 align="center">Actual MCP Server</h1>

[![npm version](https://img.shields.io/npm/v/actual-mcp-server)](https://www.npmjs.com/package/actual-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/actual-mcp-server)](https://www.npmjs.com/package/actual-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.29-orange)](https://modelcontextprotocol.io/)
[![Docker Pulls](https://img.shields.io/docker/pulls/agigante80/actual-mcp-server)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![Docker Image Size](https://img.shields.io/docker/image-size/agigante80/actual-mcp-server/latest)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![Unraid Community Apps](https://img.shields.io/badge/Unraid-Community%20Apps-f15a2c?logo=unraid&logoColor=white)](https://ca.unraid.net/apps/actual-mcp-server-0bghkvs0c7c8bg)
[![GitHub Actions CI](https://github.com/agigante80/actual-mcp-server/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/agigante80/actual-mcp-server/actions)
[![GitHub stars](https://img.shields.io/github/stars/agigante80/actual-mcp-server?style=social)](https://github.com/agigante80/actual-mcp-server)

**Talk to your budget. Run it anywhere. Trust it in production.**

Actual MCP Server is a [Model Context Protocol](https://modelcontextprotocol.io/) server that connects any MCP-compatible AI assistant (such as [LibreChat](https://www.librechat.ai/), [LobeChat](https://lobehub.com/home), [Claude Desktop](https://claude.ai/download), and more) directly to your self-hosted [Actual Budget](https://actualbudget.org/) instance. Ask natural language questions, create transactions, analyse spending, and manage your entire budget without ever opening the Actual Budget UI.

```
┌─────────────┐   MCP/HTTP    ┌──────────────────┐   Actual API   ┌──────────────┐
│  LibreChat  │ ◄───────────► │  Actual MCP      │ ◄───────────► │   Actual     │
│  LobeChat   │               │  Server          │               │   Budget     │
│  (remote)   │               │  (71 tools)      │               │   Server     │
└─────────────┘               └──────────────────┘               └──────────────┘

┌─────────────┐   MCP/stdio   ┌──────────────────┐   Actual API   ┌──────────────┐
│  Claude     │ ◄───────────► │  Actual MCP      │ ◄───────────► │   Actual     │
│  Desktop    │               │  Server          │               │   Budget     │
│  (local)    │               │  (71 tools)      │               │   Server     │
└─────────────┘               └──────────────────┘               └──────────────┘
```

### Why this project?

Most Actual Budget MCP implementations are simple stdio bridges designed for single-user, local use with Claude Desktop. This project goes further:

- **71 tools, the most comprehensive coverage available.** Accounts, transactions, categories, payees, tags, notes, rules, budgets, batch operations, bank sync, and more. Covers the reachable Actual Budget API with no genuine gaps.
- **HTTP and stdio transport.** Runs as a real remote server for LibreChat/LobeChat (`--http`), or as a direct local process for Claude Desktop (`--stdio`). No Docker or HTTP server is needed for local use.
- **6 exclusive ActualQL-powered tools.** Search and summarise transactions by month, amount, category, or payee using Actual Budget's native query engine. Aggregated results, no raw data dumped into the AI context window.
- **Multi-budget switching at runtime.** Configure multiple budget files and let the AI switch between them mid-conversation with `actual_budgets_switch`.
- **Multi-user ready with OIDC.** Secure every session with JWKS-validated JWTs and per-user budget ACLs. No shared tokens required.
- **Production-grade reliability.** Connection pooling (up to 15 concurrent sessions), automatic retry with exponential backoff, and a full test suite (unit + E2E + integration).

> **Verified working** with [LibreChat](https://www.librechat.ai/), [LobeChat](https://lobehub.com/home), and [Claude Desktop](https://claude.ai/download). All 71 tools tested end-to-end. Any MCP-compatible client should work.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Upgrading](#upgrading)
- [Available Tools](#available-tools)
- [Configuration](#configuration)
- [Multi-Budget Switching](#multi-budget-switching)
- [Transport & Authentication](#transport--authentication)
- [Testing](#testing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Quick Start

### Prerequisites

- [Actual Budget](https://actualbudget.org/) server running (local or remote)
- Your **Budget Sync ID**: Actual → Settings → Show Advanced Settings → Sync ID
- **Node.js 22+** (npm method) or **Docker**

### Option A: Docker (recommended)

```bash
docker run -d \
  --name actual-mcp-server-backend \
  -p 3600:3600 \
  # Use the same URL you type in your browser to open Actual Budget:
  #   http://localhost:5006          (if Actual Budget runs on the same machine)
  #   http://192.168.1.50:5006       (if it runs on another machine on your network)
  #   https://actual.yourdomain.com  (if you use a domain name)
  #   http://actual:5006             (if both containers share a Docker network; use container name)
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=your_secret_token \
  -v actual-mcp-data:/app/data \        # required, see note below
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest
```

> **Why the `/app/data` volume is required:** Actual Budget does not expose a REST API. The official `@actual-app/api` library (used internally by this server) works by downloading a local copy of your budget data, running all queries on that local copy, then syncing changes back. The `/app/data` volume gives the container a persistent, writable place to store that local copy (it is the directory the image creates and owns as the runtime user). Without it the container has nowhere to write and will fail on startup. See the [Actual API docs](https://actualbudget.org/docs/api/) for details.
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

### Option B: Docker Compose

```bash
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
cp .env.example .env        # fill in ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID

docker compose --profile production up -d   # production: MCP server listens on :3600
# or
docker compose --profile dev up -d          # dev mode with hot-reload
```

> The compose file defines only the `dev` and `production` profiles. The MCP server listens on `:3600` directly: there is no bundled reverse proxy and no bundled Actual Budget server, so point `ACTUAL_SERVER_URL` at your own Actual instance. For TLS, enable native HTTPS with `MCP_ENABLE_HTTPS=true` (plus `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY`), or front the server with your own reverse proxy.

### Option C: npm (HTTP server)

```bash
# Quick start via npx (no clone needed):
ACTUAL_SERVER_URL=http://localhost:5006 \
ACTUAL_PASSWORD=your_password \
ACTUAL_BUDGET_SYNC_ID=your-sync-id \
MCP_SSE_AUTHORIZATION=your_token \
npx actual-mcp-server --http

# Or clone for development / custom config:
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
npm install
cp .env.example .env        # fill in required values
npm run build
npm run dev -- --http
```

Server starts at `http://localhost:3600/http` by default (the listen port is `MCP_BRIDGE_PORT`, default `3600`).

### Option D: stdio (Claude Desktop native, no Docker or HTTP server needed)

The stdio transport runs the MCP server as a child process. Claude Desktop spawns it directly and communicates over stdin/stdout. No network port, no auth token, no Docker required. No cloning needed: `npx` downloads and caches the package automatically.

Add to `claude_desktop_config.json` (see [docs/guides/MCP_CLIENTS_SETUP.md](docs/guides/MCP_CLIENTS_SETUP.md) for config file location and all client options):

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

> **No token needed.** stdio runs as a local process owned by your user. The transport itself is the security boundary. All 71 tools are available.
>
> **`MCP_BRIDGE_DATA_DIR` should be an absolute path.** Without one, the data directory resolves relative to wherever the client spawns the process, which can be unpredictable. The directory is created automatically on first run.

### Option E: Unraid (Community Applications)

[![Unraid Community Applications](https://img.shields.io/badge/Unraid-Install%20from%20CA-f15a2c?logo=unraid&logoColor=white)](https://ca.unraid.net/apps/actual-mcp-server-0bghkvs0c7c8bg)

Actual MCP Server is published in the Unraid **Community Applications** store: **[ca.unraid.net/apps/actual-mcp-server](https://ca.unraid.net/apps/actual-mcp-server-0bghkvs0c7c8bg)**. This runs the HTTP transport, the right choice for LibreChat, LobeChat, and other remote MCP clients.

Install it from the **Apps** tab (Community Applications):

1. Open the **Apps** tab and search for **`actual-mcp-server`**, then click **Install**.
2. Fill in **Actual server URL**, **Actual server password**, and **Actual server Sync ID** (the Sync ID is in Actual Budget: open the budget, **Settings, Show advanced settings, Sync ID**).
3. **Set a strong MCP auth token.** Generate one with `openssl rand -hex 32`. A blank token disables all HTTP authentication and exposes your financial data unauthenticated on the LAN, so this is required (see [Transport & Authentication](#transport--authentication)).
4. Leave **PUID=99** and **PGID=100** (`nobody:users`) so the container can write the appdata Data and Logs directories, then start it.
5. Reach the health endpoint via the container's **WebUI** link (port `3600`); point your MCP client at `http://[server-ip]:3600/http` with the Bearer token.

The Unraid template lives in [`unraid/actual-mcp-server.xml`](unraid/actual-mcp-server.xml). For the publishing workflow see [docs/UNRAID_CA_PUBLISHING.md](docs/UNRAID_CA_PUBLISHING.md).

### Connect an AI client

**LibreChat / LobeChat**: add to `librechat.yaml` (or LobeChat MCP plugin settings):

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

**Claude Desktop via HTTP** (when the server is already running as a Docker container):

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

**Claude Desktop via stdio** (native, no HTTP server needed; see Option D above):

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/absolute/path/to/actual-mcp-server/dist/src/index.js", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/actual-mcp-server/actual-data"
      }
    }
  }
}
```

See [docs/guides/MCP_CLIENTS_SETUP.md](docs/guides/MCP_CLIENTS_SETUP.md) for all options (including Cursor, VS Code, Gemini CLI), Linux/NVM path fixes, and troubleshooting.

---

## Upgrading

### Docker (Option A)

```bash
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker stop actual-mcp-server-backend
docker rm actual-mcp-server-backend
# Re-run the original docker run command with the same flags and volumes
```

Also available on Docker Hub: `docker pull agigante80/actual-mcp-server:latest`

### Docker Compose (Option B)

```bash
docker compose pull
docker compose --profile production up -d
```

### npm / cloned repo (Option C)

```bash
git pull
npm install
npm run build
# Then restart the server
```

### npx / stdio (Options C & D)

If you run `npx actual-mcp-server` without a globally installed version, npx fetches the latest from the registry automatically. But if you previously installed it globally (`npm install -g actual-mcp-server`), the global install takes precedence, so you must upgrade it explicitly:

```bash
# Upgrade the global install
npm install -g actual-mcp-server

# Or force the registry version without touching your global install
npx actual-mcp-server@latest --http
```

For Claude Desktop (stdio), restart Claude after upgrading.

---

## Available Tools

**71 tools** across all categories. All tools use the `actual_<category>_<action>` naming convention.

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

### Transactions (13)

**Standard (6)**

| Tool | Description |
|------|-------------|
| `actual_transactions_get` | Get transactions for an account |
| `actual_transactions_filter` | Filter with advanced criteria |
| `actual_transactions_create` | Create new transaction(s) |
| `actual_transactions_import` | Import and reconcile transactions |
| `actual_transactions_update` | Update a transaction |
| `actual_transactions_delete` | Delete a transaction |

**Utility (1)**

| Tool | Description |
|------|-------------|
| `actual_transactions_uncategorized` | Summary of uncategorized transactions (totalCount, totalAmount, per-account breakdown); pass `includeTransactions:true` for paginated rows |

**Exclusive ActualQL-powered (6)**, unique to this MCP server

| Tool | Description |
|------|-------------|
| `actual_transactions_search_by_month` | Search by month using `$month` transform |
| `actual_transactions_search_by_amount` | Find by amount range |
| `actual_transactions_search_by_category` | Search by category name |
| `actual_transactions_search_by_payee` | Find by payee/vendor |
| `actual_transactions_summary_by_category` | Spending summary grouped by category |
| `actual_transactions_summary_by_payee` | Top vendors with totals and counts |

### Transfers (1)

| Tool | Description |
|------|-------------|
| `actual_transfers_create` | Create a paired transfer between two accounts (debit + credit linked by `transfer_id`, identical to UI "Make Transfer") |

> **Note:** Use `actual_transfers_create` for any account-to-account movement, not `actual_transactions_create`. The dedicated tool creates both sides (debit and credit) atomically so the books stay balanced. Limitations: both accounts must exist and be open, and `from_account` must differ from `to_account`.

### Categories (4)

`actual_categories_get` · `actual_categories_create` · `actual_categories_update` · `actual_categories_delete`

### Category Groups (4)

`actual_category_groups_get` · `actual_category_groups_create` · `actual_category_groups_update` · `actual_category_groups_delete`

### Payees (7)

`actual_payees_get` · `actual_payees_common_list` · `actual_payees_create` · `actual_payees_update` · `actual_payees_delete` · `actual_payees_merge` · `actual_payee_rules_get`

### Tags (4)

`actual_tags_list` · `actual_tags_create` · `actual_tags_update` · `actual_tags_delete`

| Tool | Description |
|------|-------------|
| `actual_tags_list` | List all tags (id, tag word, optional color and description) |
| `actual_tags_create` | Create or upsert a tag by name; returns the tag UUID |
| `actual_tags_update` | Update tag name, color, or description by UUID |
| `actual_tags_delete` | Soft-delete a tag by UUID |

### Notes (2)

`actual_notes_get` · `actual_notes_update`

| Tool | Description |
|------|-------------|
| `actual_notes_get` | Get the note for any entity (account/category/category-group/payee UUID, or budget-YYYY-MM) |
| `actual_notes_update` | Set or clear the note for any entity; validates entity exists or matches budget-YYYY-MM pattern |

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

`actual_budget_updates_batch`: batch multiple budget updates in one call

### Server Information & Lookup (4)

| Tool | Description |
|------|-------------|
| `actual_server_info` | Server status, version, build info |
| `actual_server_get_version` | Actual Budget server version |
| `actual_get_id_by_name` | Resolve an exact name → UUID for accounts, categories, payees |
| `actual_entities_search` | Find accounts/categories/payees by a name pattern (contains/startsWith/endsWith/exact/fuzzy). Fixes "payee not found" from a partial or mistyped name |

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
| `ACTUAL_SERVER_URL` | _(none)_ | Yes | URL of your Actual Budget server. Use the same URL you type in your browser: `http://localhost:5006` (local), `http://192.168.1.x:5006` (network), `https://actual.yourdomain.com` (domain), or `http://actual:5006` (container name if on the same Docker network) |
| `ACTUAL_PASSWORD` | _(none)_ | Yes | Password for Actual Budget server |
| `ACTUAL_BUDGET_SYNC_ID` | _(none)_ | Yes | Budget Sync ID from Actual (Settings then Sync ID) |
| `ACTUAL_BUDGET_PASSWORD` | _(none)_ | No | Optional encryption password for encrypted budgets |
| `ALLOW_INSECURE_UPSTREAM` | `false` | No | Allow an `http://` upstream even when `ACTUAL_BUDGET_PASSWORD` is set (#161). Off by default so a plaintext upstream plus an encryption password is refused |
| **MCP Server Settings** ||||
| `MCP_BRIDGE_PORT` | `3600` | No | Port for MCP server to listen on |
| `MCP_BRIDGE_BIND_HOST` | `0.0.0.0` | No | Host address to bind server to (`0.0.0.0` = all interfaces) |
| `MCP_BRIDGE_DATA_DIR` | `./actual-data` | No | Directory to store Actual Budget local data (SQLite). **Required to be a persistent path.** The `@actual-app/api` library downloads a local copy of your budget here to run queries; use a volume mount in Docker to persist it across restarts |
| `MCP_BRIDGE_PUBLIC_HOST` | auto-detected | No | Public hostname/IP for server (shown in logs) |
| `MCP_BRIDGE_PUBLIC_SCHEME` | auto-detected | No | Public scheme (`http` or `https`) |
| `MCP_BRIDGE_USE_TLS` | `false` | No | Set to `true` to advertise `https://` in the server URL (for reverse-proxy setups where TLS is terminated upstream) |
| **Transport Configuration** ||||
| `MCP_TRANSPORT_MODE` | `--http` | No | Transport mode. Only `--http` is a valid value; stdio is selected via the `--stdio` CLI flag, not this var |
| `MCP_HTTP_PATH` | `/http` | No | HTTP endpoint routing path |
| `MCP_BRIDGE_HTTP_PATH` | same as `MCP_HTTP_PATH` | No | Advertised HTTP path shown to clients (set when a reverse proxy rewrites the path) |
| `MCP_HTTP_BODY_LIMIT` | `512kb` | No | Maximum accepted JSON-RPC request body size (e.g. `512kb`, `1mb`) |
| **Session Management** ||||
| `USE_CONNECTION_POOL` | `true` | No | Enable session-based connection pooling |
| `MAX_CONCURRENT_SESSIONS` | `15` | No | Maximum concurrent MCP sessions allowed |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `5` | No | Minutes before idle session cleanup |
| **Security & Authentication** ||||
| `AUTH_PROVIDER` | `none` | No | Auth mode: `none` (static Bearer) or `oidc` (JWKS-validated JWT) |
| `MCP_SSE_AUTHORIZATION` | _(none)_ | No | Static Bearer token (`AUTH_PROVIDER=none`; highly recommended in production) |
| `MCP_ALLOW_UNAUTHENTICATED` | `false` | No | Opt-out for required-by-default HTTP auth (#242). On a non-loopback bind with no token and no OIDC the server refuses to start; set to `true` to run open deliberately (e.g. behind your own proxy) |
| `OIDC_ISSUER` | _(none)_ | If OIDC | OIDC issuer URL (e.g., `https://sso.example.com`) |
| `OIDC_ALLOW_INSECURE_ISSUER` | `false` | No | Allow a plaintext (http) OIDC issuer on a trusted network (#244). Off by default (http issuer refused at startup); set `true` only for local/LAN testing |
| `OIDC_RESOURCE` | _(none)_ | No | Expected `aud` claim in JWT (your client ID) |
| `OIDC_ACCEPTED_AUDIENCES` | _(none)_ | No | Extra accepted `aud` values beyond `OIDC_RESOURCE`, comma-separated (#245). For IdPs that put the client-id in `aud` (e.g. Authentik). Strict allowlist, never a wildcard |
| `OIDC_SCOPES` | _(none)_ | No | Comma-separated required scopes; leave empty for Casdoor |
| `AUTH_BUDGET_ACL` | _(none)_ | No | Per-user budget ACL; see [AI Client Setup](docs/guides/AI_CLIENT_SETUP.md#oidc-authentication-multi-user) |
| `MCP_ENABLE_HTTPS` | `false` | No | Enable native TLS. Requires `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY` |
| `MCP_HTTPS_CERT` | _(none)_ | No | Path to PEM certificate file (required when `MCP_ENABLE_HTTPS=true`) |
| `MCP_HTTPS_KEY` | _(none)_ | No | Path to PEM private key file (required when `MCP_ENABLE_HTTPS=true`) |
| **Logging Configuration** ||||
| `MCP_BRIDGE_STORE_LOGS` | `false` | No | Enable file logging (vs console only) |
| `MCP_BRIDGE_LOG_DIR` | `app/logs` (beside the install) | No | Directory for log files (if `STORE_LOGS=true`). `.env.example` and Docker set it explicitly (e.g. `./logs`, `/app/logs`) |
| `MCP_BRIDGE_LOG_LEVEL` | `debug` (dev) / `info` (prod) | No | Log level: `error`, `warn`, `info`, `debug` |
| `LOG_FORMAT` | auto | No | Log output format: `json` or `pretty`. Precedence: explicit `LOG_FORMAT` wins, else `NODE_ENV=production` selects `json`, else `pretty` |
| `MCP_SERVICE_NAME` | `actual-mcp-server` | No | Service name stamped on every structured (json) log record |
| **Log Rotation** (when `MCP_BRIDGE_STORE_LOGS=true`) ||||
| `MCP_BRIDGE_MAX_FILES` | `14d` | No | Keep rotated logs for N days (e.g., `14d`, `30d`) |
| `MCP_BRIDGE_MAX_LOG_SIZE` | `20m` | No | Rotate when file reaches size (e.g., `20m`, `100m`) |
| `MCP_BRIDGE_ROTATE_DATEPATTERN` | `YYYY-MM-DD` | No | Date pattern for rotated log filenames |
| **Development & Debugging** ||||
| `DEBUG` | _(none)_ | No | Enable debug mode (verbose logging) when set to any truthy value |
| `LOG_LEVEL` | _(none)_ | No | Debug-detection toggle: set to `debug` to enable extra transport debug output. Distinct from `MCP_BRIDGE_LOG_LEVEL` (the winston level); has no default and is not itself a log level |
| `MCP_BRIDGE_DEBUG_TRANSPORT` | `false` | No | Enable transport-level debug logging |
| **Advanced/Internal** ||||
| `ACTUAL_API_CONCURRENCY` | `5` | No | Max concurrent Actual API operations |
| `NODE_ENV` | _(none)_ / `production` | No | Node environment. No app default; the Docker image sets `production`, which selects json logs and hides stack traces in error responses |
| `VERSION` | auto-detected | No | Server version (auto-set by build/Docker) |
| `TZ` | `UTC` | No | Timezone for timestamps (e.g., `America/New_York`) |

---

## Multi-Budget Switching

Configure multiple Actual Budget files so the AI can switch between them at runtime using `actual_budgets_list_available` and `actual_budgets_switch`.

`BUDGET_N_SERVER_URL` and `BUDGET_N_PASSWORD` fall back to `ACTUAL_SERVER_URL` / `ACTUAL_PASSWORD` when omitted.

| Variable | Required | Fallback |
|----------|----------|---------|
| `BUDGET_DEFAULT_NAME` | No | `"Default"` |
| `BUDGET_N_NAME` | Yes (enables group) | _(none)_ |
| `BUDGET_N_SYNC_ID` | Yes | _(none)_ |
| `BUDGET_N_SERVER_URL` | No | `ACTUAL_SERVER_URL` |
| `BUDGET_N_PASSWORD` | No | `ACTUAL_PASSWORD` |
| `BUDGET_N_ENCRYPTION_PASSWORD` | No | _(none)_ |

```bash
# Default budget
ACTUAL_SERVER_URL=http://actual:5006
ACTUAL_PASSWORD=my-password
ACTUAL_BUDGET_SYNC_ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
BUDGET_DEFAULT_NAME=Personal

# Budget 1 (same server, same password)
BUDGET_1_NAME=Family
BUDGET_1_SYNC_ID=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

# Budget 2 (different server)
BUDGET_2_NAME=Business
BUDGET_2_SERVER_URL=https://actual-office.example.com
BUDGET_2_PASSWORD=office-password
BUDGET_2_SYNC_ID=cccccccc-cccc-cccc-cccc-cccccccccccc
```

---

## Transport & Authentication

The server supports two transport modes:

| Mode | Flag | Use case | Auth |
|------|------|----------|------|
| HTTP | `--http` | LibreChat, LobeChat, Docker, multi-user deployments | Bearer token or OIDC |
| stdio | `--stdio` | Claude Desktop, Cursor, local single-user use | None (OS process isolation) |

The two modes are mutually exclusive. Pass exactly one flag when starting the server.

### stdio transport

stdio is the simplest way to connect Claude Desktop directly to Actual Budget. The MCP server runs as a child process; Claude Desktop spawns it, communicates over stdin/stdout using NDJSON (the MCP wire format), and the process exits cleanly when Claude Desktop closes.

**Key properties of stdio mode:**

- No network port. The transport is a pipe, not a socket.
- No auth token. Process ownership is the security boundary.
- All logs go to stderr so they never corrupt the JSON-RPC framing on stdout
- The process exits when stdin closes (Claude Desktop shutting down)
- All 71 tools are available, identical to HTTP mode

**Start manually to verify:**

```bash
cd /path/to/actual-mcp-server
ACTUAL_SERVER_URL=http://localhost:5006 \
ACTUAL_PASSWORD=your_password \
ACTUAL_BUDGET_SYNC_ID=your-sync-id \
node dist/src/index.js --stdio
```

Send a test request (keep stdin open with `sleep`):

```bash
{ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'; sleep 5; } \
| ACTUAL_SERVER_URL=http://localhost:5006 ACTUAL_PASSWORD=your_password ACTUAL_BUDGET_SYNC_ID=your-sync-id \
  node dist/src/index.js --stdio 2>/dev/null
```

**Claude Desktop config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/absolute/path/to/actual-mcp-server/dist/src/index.js", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/actual-mcp-server/actual-data"
      }
    }
  }
}
```

> **Path must be absolute.** Claude Desktop does not inherit shell `PATH`, so `node` must also be absolute if you use NVM or a non-standard install: `/home/youruser/.nvm/versions/node/v22.x.x/bin/node`.

See [docs/guides/MCP_CLIENTS_SETUP.md](docs/guides/MCP_CLIENTS_SETUP.md) for all connection options (stdio native, mcp-remote via HTTP/HTTPS), other clients (Cursor, VS Code, Gemini CLI, Claude Code), Linux path fixes, and troubleshooting.

### HTTP transport

**HTTP transport** uses the `/http` endpoint (StreamableHTTP) with optional Bearer token or OIDC authentication.

#### Static Bearer token (single-user)

```bash
# Generate a token
openssl rand -hex 32

# Add to .env
MCP_SSE_AUTHORIZATION=your_token_here
```

Clients send: `Authorization: Bearer your_token_here`

#### OIDC (multi-user)

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://sso.yourdomain.com
OIDC_RESOURCE=your-client-id    # must match 'aud' JWT claim
OIDC_SCOPES=                    # leave empty for Casdoor
```

See [AI Client Setup, OIDC](docs/guides/AI_CLIENT_SETUP.md#oidc-authentication-multi-user) for `AUTH_BUDGET_ACL` format and Casdoor notes.

---

## Testing

| Command | What It Tests | Requires Live Server |
|---------|---------------|---------------------|
| `npm run build` | TypeScript compilation | No |
| `npm run test:unit-js` | 71-tool smoke, schema validation, auth ACL | No |
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
| [docs/guides/MCP_CLIENTS_SETUP.md](docs/guides/MCP_CLIENTS_SETUP.md) | **Start here** to connect Claude Desktop, Cursor, VS Code (Copilot), Gemini CLI, or Claude Code |
| [docs/guides/AI_CLIENT_SETUP.md](docs/guides/AI_CLIENT_SETUP.md) | LibreChat & LobeChat setup, Docker networking, HTTPS/TLS proxy, OIDC |
| [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md) | Docker, Docker Compose profiles, production config, Kubernetes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component layers, data flow, transport protocols |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) | Auth models, threat model, hardening |
| [docs/TESTING_AND_RELIABILITY.md](docs/TESTING_AND_RELIABILITY.md) | Test strategy, coverage, reliability patterns |
| [docs/NEW_TOOL_CHECKLIST.md](docs/NEW_TOOL_CHECKLIST.md) | Step-by-step guide for adding a new MCP tool |
| [CONTRIBUTING.md](.github/CONTRIBUTING.md) | Development setup, code standards, PR process |
| [.env.example](.env.example) | Fully annotated environment variable reference |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup, code standards, and the PR process.

Quick flow:
1. Fork → `git checkout -b feature/my-feature`
2. Make changes + add tests
3. `npm run build && npm run test:unit-js` must pass
4. Open a Pull Request

---

## Architecture

- **Runtime**: Node.js 22 (Alpine Linux in Docker)
- **Language**: TypeScript (ESM, NodeNext module resolution)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Actual API**: `@actual-app/api`
- **Validation**: Zod (runtime types + JSON Schema for tool inputs)
- **Transports**: Express + StreamableHTTP (`--http`) · `StdioServerTransport` (`--stdio`)
- **Logging**: Winston with daily rotation (all output routed to stderr in stdio mode)

Every Actual API call goes through the `withActualApi()` wrapper in `src/lib/actual-adapter.ts`, which handles init/shutdown lifecycle, retry (3 attempts, exponential backoff), and concurrency limiting. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full design documentation.

---

## License

MIT. See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- **[Actual Budget](https://actualbudget.org/)**: open-source budgeting software
- **[Model Context Protocol](https://modelcontextprotocol.io/)**: standardised AI-app integration
- **[LibreChat](https://github.com/danny-avila/LibreChat)**: open-source ChatGPT alternative
- **[s-stefanov/actual-mcp](https://github.com/s-stefanov/actual-mcp)**: original adapter pattern

---

## Disclaimer

This project started as a **personal learning exercise** to explore the [Model Context Protocol](https://modelcontextprotocol.io/) technology. It is an independent open-source project, not affiliated with, endorsed by, or supported by [Actual Budget](https://actualbudget.org/) or any other organisation.

The software is provided **as-is**, without warranty of any kind. The author accepts no responsibility for how it is used, for any data loss, financial errors, or other consequences arising from its use. If you connect it to real financial data, you do so entirely at your own risk.

---

## Support

- **[GitHub Issues](https://github.com/agigante80/actual-mcp-server/issues)**: bug reports and feature requests
- **[GitHub Discussions](https://github.com/agigante80/actual-mcp-server/discussions)**: questions and ideas

---

**Version:** 0.7.10 | **Tool Count:** 71 (verified LibreChat-compatible)
