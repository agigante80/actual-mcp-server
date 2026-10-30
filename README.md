<p align="center">
  <img src="unraid/actual-mcp-icon.png" alt="Actual MCP Server icon" width="128" height="128">
</p>

<h1 align="center">Actual MCP Server</h1>

[![npm version](https://img.shields.io/npm/v/actual-mcp-server)](https://www.npmjs.com/package/actual-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/actual-mcp-server)](https://www.npmjs.com/package/actual-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue)](https://www.typescriptlang.org/)
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
│  (remote)   │               │  (84 tools)      │               │   Server     │
└─────────────┘               └──────────────────┘               └──────────────┘

┌─────────────┐   MCP/stdio   ┌──────────────────┐   Actual API   ┌──────────────┐
│  Claude     │ ◄───────────► │  Actual MCP      │ ◄───────────► │   Actual     │
│  Desktop    │               │  Server          │               │   Budget     │
│  (local)    │               │  (84 tools)      │               │   Server     │
└─────────────┘               └──────────────────┘               └──────────────┘
```

### Why this project?

Most Actual Budget MCP implementations are simple stdio bridges designed for single-user, local use with Claude Desktop. This project goes further:

- **84 tools** across accounts, transactions, categories, payees, tags, notes, rules, budgets, batch operations, bank sync, and more. Every tool is listed with its description in the [tools reference](docs/reference/tools.md), and `npm run check:coverage` reports which `@actual-app/api` methods have no tool.
- **HTTP and stdio transport.** Runs as a real remote server for LibreChat/LobeChat (`--http`), or as a direct local process for Claude Desktop (`--stdio`). No Docker or HTTP server is needed for local use.
- **Exclusive ActualQL-powered tools.** Search and summarise transactions by month, amount, category, or payee using Actual Budget's native query engine. Aggregated results, no raw data dumped into the AI context window.
- **Multi-budget switching at runtime.** Configure multiple budget files and let the AI switch between them mid-conversation with `actual_budgets_switch`. Works on both transports: HTTP keys the active budget to the MCP session, and stdio (Claude Desktop, Claude Code, Cursor) gets a synthetic per-process session so a switch is scoped to that process rather than shared globally (#348).
- **Multi-user ready with OIDC.** Secure every session with JWKS-validated JWTs and per-user budget ACLs. No shared tokens required.
- **Connection pooling and retries on both transports.** HTTP connection pooling (up to 15 concurrent sessions), and a long-lived stdio process that logs in ONCE and reuses that connection for every tool call instead of re-authenticating per call, so Claude Desktop and Claude Code stay fast and a burst of calls no longer risks a per-call login storm against the upstream limiter. Automatic retry with exponential backoff, and a full test suite (unit + E2E + integration).

> **Verified working** with [LibreChat](https://www.librechat.ai/), [LobeChat](https://lobehub.com/home), and [Claude Desktop](https://claude.ai/download). All 84 tools tested end-to-end. Any MCP-compatible client should work.

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
- [Architecture](#architecture)
- [License](#license)
- [Acknowledgments](#acknowledgments)
- [Disclaimer](#disclaimer)
- [Support](#support)
- [Sponsor](#sponsor)

---

## Quick Start

### Prerequisites

- [Actual Budget](https://actualbudget.org/) server running (local or remote)
- Your **Budget Sync ID**: Actual → Settings → Show Advanced Settings → Sync ID
- **Node.js 22+** (npm method) or **Docker**

### Option A: Docker (recommended)

**1. Create `.env` with a generated token.** Run this in an empty directory. It creates a private `.env` (mode 600), adds the three Actual settings for you to fill in, and writes a random `MCP_SSE_AUTHORIZATION` token. It never overwrites a value you already set, except a token that is missing, duplicated or shorter than 32 characters, so it is safe to run again:

<!-- runnable: env-token -->
```bash
[ -f .env ] || install -m 600 /dev/null .env
[ -z "$(tail -c 1 .env)" ] || printf '\n' >> .env
for key in ACTUAL_SERVER_URL=http://YOUR-ACTUAL-HOST:5006 ACTUAL_PASSWORD= ACTUAL_BUDGET_SYNC_ID=; do
  grep -q "^${key%%=*}=" .env || printf '%s\n' "$key" >> .env
done
chmod 600 .env
if [ "$(grep -c '^MCP_SSE_AUTHORIZATION=' .env)" != 1 ] || ! grep -Eq '^MCP_SSE_AUTHORIZATION=[^[:space:]]{32,}$' .env; then
  ( umask 077; install -m 600 /dev/null .env.new; { grep -v '^MCP_SSE_AUTHORIZATION=' .env; printf 'MCP_SSE_AUTHORIZATION=%s\n' "$(openssl rand -hex 32)"; } > .env.new ) && mv .env.new .env
fi
grep '^MCP_SSE_AUTHORIZATION=' .env
```

The last line prints your token. It is the Bearer token your MCP client sends, and it stays in this terminal's scrollback, so clear it if the terminal is shared.

**2. Fill in `.env`.** Set `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_SYNC_ID` (Actual: Settings, Show advanced settings, Sync ID) and `ACTUAL_SERVER_URL`. The URL is read **inside the container**, where `localhost` is the container itself, never your Actual server. Use one of:

- the LAN address or domain of the Actual server: `http://192.168.1.50:5006`, `https://actual.yourdomain.com`
- `http://host.docker.internal:5006` when Actual runs on the Docker host itself (the `--add-host` line below makes that name resolve on Linux; Docker Desktop provides it)
- the container name, `http://actual:5006`, when both containers share a user-defined Docker network (add `--network <name>` to the command below)

**3. Start the server** from the same directory:

<!-- runnable: docker-run -->
```bash
docker run -d \
  --name actual-mcp-server-backend \
  -p 3600:3600 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -v actual-mcp-data:/app/data \
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest
```

Passwords and the token come from `.env`, so they never land in your shell history. Once it works, recreate it with `--restart unless-stopped` added before the image name so Docker restarts it after a reboot.

> **Why the `/app/data` volume is required:** Actual Budget does not expose a REST API. The official `@actual-app/api` library (used internally by this server) works by downloading a local copy of your budget data, running all queries on that local copy, then syncing changes back. The `/app/data` volume gives the container a persistent, writable place to store that local copy (it is the directory the image creates and owns as the runtime user). Without it the container still starts, but the local copy is lost each time the container is replaced and the next start downloads the budget again. See the [Actual API docs](https://actualbudget.org/docs/api/) for details.
>
> **actual-mcp does not need to run on the same machine as Actual Budget.** You can have Actual Budget on one server and actual-mcp on another - as long as `ACTUAL_SERVER_URL` points to your Actual Budget instance, everything works.

**Verify it's running:**

```bash
# Quick health check
curl http://localhost:3600/health
# Expected: {"status":"ok","transport":"http","version":"..."}

# Full MCP handshake (also verifies your token; run it next to your .env)
curl -s -X POST http://localhost:3600/http \
  -H "Authorization: Bearer $(sed -n 's/^MCP_SSE_AUTHORIZATION=//p' .env)" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"cli-test","version":"1.0"}}}' \
  | python3 -m json.tool
# Success: JSON response with "protocolVersion" and "serverInfo"
# Wrong token: {"error": "Unauthorized"}
# Server not running: curl: (7) Failed to connect
```

Also available on Docker Hub: `agigante80/actual-mcp-server:latest`

### Option B: Docker Compose

Needs Docker Compose 2.24.0 or later (`docker compose version`).

```bash
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
```

Then create `.env` from the template (an existing `.env` is never overwritten), add a generated token, and start the `production` service, which pulls `ghcr.io/agigante80/actual-mcp-server:latest`:

<!-- runnable: compose-production -->
```bash
[ -f .env ] || install -m 600 .env.example .env
chmod 600 .env
if [ "$(grep -c '^MCP_SSE_AUTHORIZATION=' .env)" != 1 ] || ! grep -Eq '^MCP_SSE_AUTHORIZATION=[^[:space:]]{32,}$' .env; then
  ( umask 077; install -m 600 /dev/null .env.new; { grep -v '^MCP_SSE_AUTHORIZATION=' .env; printf 'MCP_SSE_AUTHORIZATION=%s\n' "$(openssl rand -hex 32)"; } > .env.new ) && mv .env.new .env
fi
grep '^MCP_SSE_AUTHORIZATION=' .env
docker compose --profile production up -d
```

The printed line is your client's Bearer token. On a fresh `.env` the template values are placeholders: fill in `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD` and `ACTUAL_BUDGET_SYNC_ID` (the container `localhost` rule from Option A applies here too; `http://host.docker.internal:5006` reaches an Actual server on the Docker host), then run `docker compose --profile production up -d` again, which recreates the container with the new values. Without a `.env` at all, `up` stops with `ACTUAL_SERVER_URL is required`. Without a token (and without OIDC) the container exits at startup, and `docker compose logs` shows `Refusing to start` with the fix.

> The compose file defines only the `dev` and `production` profiles. The MCP server listens on `:3600` directly: there is no bundled reverse proxy and no bundled Actual Budget server, so point `ACTUAL_SERVER_URL` at your own Actual instance. For TLS, enable native HTTPS with `MCP_ENABLE_HTTPS=true` (plus `MCP_HTTPS_CERT` and `MCP_HTTPS_KEY`), or front the server with your own reverse proxy.
>
> **Contributors:** the `dev` profile is a hot-reload stack that builds from source and runs **without authentication**. It is bound to `127.0.0.1:3600` only, but that still leaves it reachable by every local process, by containers on the same Docker network, and by a web page through DNS rebinding. Use it on a machine you trust, never as a deployment.

### Option C: npm (HTTP server)

> **Requires Node.js 22+.** npm and npx do not enforce this, so check with `node --version` first. On an older Node the server refuses to start and tells you so. Note that `npx` runs whichever `node` is first on your `PATH`, which is not always the one you installed most recently.

Quick start via npx, no clone needed. The server reads `.env` from the directory you start it in, so create one first with the Option A step 1 block and fill it in. This is not a container, so `ACTUAL_SERVER_URL=http://localhost:5006` is right when Actual runs on the same machine. Then, in that directory:

<!-- runnable: npx-http -->
```bash
npx actual-mcp-server --http
```

Or clone for development or a custom config:

```bash
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
npm install
[ -f .env ] || install -m 600 .env.example .env   # then fill in the required values
npm run build
npm run dev -- --http
```

Server starts at `http://localhost:3600/http` by default (the listen port is `MCP_BRIDGE_PORT`, default `3600`).

### Option D: stdio (Claude Desktop native, no Docker or HTTP server needed)

The stdio transport runs the MCP server as a child process. Claude Desktop spawns it directly and communicates over stdin/stdout. No network port, no auth token, no Docker required. No cloning needed: `npx` downloads and caches the package automatically.

Add to `claude_desktop_config.json` (see [docs/guides/clients/claude-desktop.md](docs/guides/clients/claude-desktop.md) for the config file location, and [docs/guides/clients/](docs/guides/clients/README.md) for every other client):

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

> **No token needed.** stdio runs as a local process owned by your user. The transport itself is the security boundary. All 84 tools are available.
>
> **`MCP_BRIDGE_DATA_DIR` should be an absolute path.** Without one, the data directory resolves relative to wherever the client spawns the process, which can be unpredictable. The directory is created automatically on first run.

### Option E: Unraid (Community Applications)

[![Unraid Community Applications](https://img.shields.io/badge/Unraid-Install%20from%20CA-f15a2c?logo=unraid&logoColor=white)](https://ca.unraid.net/apps/actual-mcp-server-0bghkvs0c7c8bg)

Actual MCP Server is published in the Unraid **Community Applications** store: **[ca.unraid.net/apps/actual-mcp-server](https://ca.unraid.net/apps/actual-mcp-server-0bghkvs0c7c8bg)**. This runs the HTTP transport, the right choice for LibreChat, LobeChat, and other remote MCP clients.

Install it from the **Apps** tab (Community Applications):

1. Open the **Apps** tab and search for **`actual-mcp-server`**, then click **Install**.
2. Fill in **Actual server URL**, **Actual server password**, and **Actual server Sync ID** (the Sync ID is in Actual Budget: open the budget, **Settings, Show advanced settings, Sync ID**).
3. **Set a strong MCP auth token.** Generate one with `openssl rand -hex 32`. Without a bearer token, per-client tokens (`MCP_STATIC_TOKENS`) or OIDC, the server refuses to start on a non-loopback bind, unless you set `MCP_ALLOW_UNAUTHENTICATED=true` deliberately; with that opt-out every tool, writes included, is served to anyone who can reach the port. A reverse proxy that does not authenticate does not replace the token. See [Transport & Authentication](#transport--authentication).
4. Leave **PUID=99** and **PGID=100** (`nobody:users`) so the container can write the appdata Data and Logs directories, then start it.
5. Reach the health endpoint via the container's **WebUI** link (port `3600`); point your MCP client at `http://[server-ip]:3600/http` with the Bearer token.

The Unraid template lives in [`unraid/actual-mcp-server.xml`](unraid/actual-mcp-server.xml). For the publishing workflow see [docs/development/unraid-ca-publishing.md](docs/development/unraid-ca-publishing.md).

### Connect an AI client

**LibreChat / LobeChat**: add to `librechat.yaml` (or LobeChat MCP plugin settings):

The URL below uses the container name, which resolves only when LibreChat and the MCP server share a user-defined Docker network. Create one once with `docker network create actual-mcp`, start the MCP server with `--network actual-mcp` added to the Option A command, and attach LibreChat's container with `docker network connect actual-mcp <librechat-container>`. Otherwise use `http://<host-ip>:3600/http`. The header carries the token the Option A block printed.

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

See [LibreChat](docs/guides/clients/librechat.md), [LobeChat](docs/guides/clients/lobechat.md), [Connecting another container](docs/guides/deployment.md#connecting-another-container-docker-network) and [HTTPS and reverse proxy](docs/guides/deployment.md#https-and-reverse-proxy) for the full setup.

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

See [docs/guides/clients/](docs/guides/clients/README.md) for every client (including Cursor, VS Code, Gemini CLI), Linux/NVM path fixes, and troubleshooting.

---

## Upgrading

Requirements and the changes that can stop an upgraded server from starting are in [docs/guides/upgrading.md](docs/guides/upgrading.md).

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

**84 tools** across accounts, transactions, transfers, categories, payees, tags, notes, budgets, rules, schedules, queries, batch operations and sessions. Every tool, with its description and caveats, is in the [tools reference](docs/reference/tools.md).

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` to get started.

### Environment variables

The three required variables and the common optional ones:

<!-- env-summary:start -->
| Variable | Required | Description |
|----------|----------|-------------|
| `ACTUAL_SERVER_URL` | Yes | URL of your Actual Budget server, as seen from where the MCP server runs. Inside a container `localhost` is the container itself: use the host's address, the container name on a shared Docker network, or `http://host.docker.internal:5006` |
| `ACTUAL_PASSWORD` | Yes | Login password for your Actual Budget **server** (not the budget encryption password) |
| `ACTUAL_BUDGET_SYNC_ID` | Yes | Budget Sync ID from Actual (Settings then Sync ID) |
| `ACTUAL_BUDGET_PASSWORD` | No | Encryption password for an end-to-end encrypted budget |
| `MCP_BRIDGE_PORT` | No | Port the MCP server listens on |
| `MCP_SSE_AUTHORIZATION` | No | Static Bearer token clients must send (the raw token, not `Bearer ...`); highly recommended in production |
| `AUTH_PROVIDER` | No | `none` (static Bearer) or `oidc` (JWKS-validated JWT) |
| `MCP_TOOLSETS` | No | Toolset groups and presets to publish; see [Reducing the tool surface](#reducing-the-tool-surface) |
<!-- env-summary:end -->

Every variable, with its type, default, whether it is secret, and where it is read, is in the configuration reference: [docs/reference/configuration.md](docs/reference/configuration.md).

### Reducing the tool surface

All 84 tools are published by default. Chat clients with a small tool budget (Gemini, LibreChat) do better with fewer, so the surface can be narrowed at startup. A tool that is not published is also refused if a client calls it by name, and the refusal names the setting responsible.

<!-- BEGIN GENERATED: tools-summary -->
<!-- Generated from dist/src/lib/toolsets.js by `npm run docs:gen`. Do not edit. -->
| Toolset | Tools | Contents |
|---------|-------|----------|
| `context` | 14 | Orientation, lookups and server information |
| `transactions` | 14 | Transaction reads, create, update, delete, import and transfers |
| `analysis` | 7 | Summaries, aggregates and balances |
| `budget` | 10 | Budget months, amounts, carryover, holds, transfers, batch updates and notes |
| `rules` | 7 | Rules and payee rules, including `actual_rules_create_batch` |
| `schedules` | 4 | Scheduled transactions |
| `structure` | 21 | Accounts, account groups, categories, category groups, payees and tags |
| `query` | 1 | `actual_query_run` (SELECT only) |
| `admin` | 6 | Budget switching, import, export, bank sync and session management |

The `chat` preset publishes 12 tools: `actual_get_context`, `actual_query_run`, `actual_transactions_update_batch`, `actual_budget_updates_batch`, `actual_rules_create_batch`, `actual_transactions_create`, `actual_transactions_update`, `actual_transactions_delete`, `actual_rules_create`, `actual_budgets_transfer`, `actual_budgets_setAmount` and `actual_budgets_getMonth`.

`MCP_READ_ONLY=true` hides and refuses 48 write-capable tools and leaves 36 published.
<!-- END GENERATED: tools-summary -->

Each tool is in exactly one group. The `chat` preset cuts across them, and its `tools/list` payload is about a quarter of the full one.

Under `MCP_READ_ONLY=true` the hidden tools include `actual_bank_sync`, `actual_budgets_export`, `actual_budgets_switch` and `actual_session_close`. `actual_session_list` stays available under read-only. See [Security and Privacy](docs/explanation/security-and-privacy.md#tool-surface-mcp_toolsets-and-mcp_read_only).

Example: a chat assistant.

```bash
MCP_TOOLSETS=chat
MCP_TOOLS=actual_accounts_list,actual_payees_get
```

Example: a read-only household assistant.

```bash
MCP_TOOLSETS=context,analysis,query
MCP_READ_ONLY=true
```

A configuration that resolves to zero tools refuses to start.

---

## Multi-Budget Switching

Configure multiple Actual Budget files so the AI can switch between them at runtime using `actual_budgets_list_available` and `actual_budgets_switch`. The variables, an example and the numbering rule are in [docs/guides/multiple-budgets.md](docs/guides/multiple-budgets.md).

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
- All 84 tools are available, identical to HTTP mode

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
{ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'; sleep 5; } \
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

See [docs/guides/clients/claude-desktop.md](docs/guides/clients/claude-desktop.md) for all connection options (stdio native, mcp-remote via HTTP/HTTPS), and [docs/guides/clients/](docs/guides/clients/README.md) for other clients (Cursor, VS Code, Gemini CLI, Claude Code), Linux path fixes, and troubleshooting.

### HTTP transport

**HTTP transport** uses the `/http` endpoint (StreamableHTTP) with optional Bearer token or OIDC authentication.

#### Static Bearer token (single-user)

Generate it with the Option A step 1 block (or the same lines in Option B): it writes a random 64-character `MCP_SSE_AUTHORIZATION` to `.env`, replaces a missing, duplicated or short one, and prints it. Never use a placeholder such as `your_token_here`: the server only checks that a token is set, so a placeholder is accepted as a real secret.

Clients send: `Authorization: Bearer <the printed token>`

#### OIDC (multi-user)

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://sso.yourdomain.com
OIDC_RESOURCE=https://actual-mcp.yourdomain.com/http   # this server's public MCP URL (the expected 'aud')
OIDC_ACCEPTED_AUDIENCES=your-client-id                  # only if your IdP puts the client id in 'aud' (#245)
OIDC_SCOPES=                                            # leave empty when the tokens carry no scope claim
# OIDC_SCOPES_SUPPORTED=openid,offline_access           # extra scopes advertised in discovery without enforcement (#472)
```

`OIDC_RESOURCE` is the canonical URL of this MCP server (the MCP authorization spec's "canonical server URI" and the RFC 9728 resource identifier), not an IdP client id: the protected-resource metadata route and the expected token audience are both derived from it, and a value that is not an absolute http(s) URL refuses to start with a message naming the variable (#461). Use the full public endpoint URL (`https://host/http`, or whatever `MCP_BRIDGE_HTTP_PATH` / `MCP_HTTP_PATH` advertises) rather than the bare origin: with the endpoint form the server publishes both the path-specific document (canonical) and a root copy for clients that look only at the root (#473), and it warns at startup when the resource path and advertised path disagree.

**OAuth discovery endpoints (automatic in OIDC mode).** When `AUTH_PROVIDER=oidc`, the server publishes the two metadata documents an OAuth client needs to bootstrap a login, so `mcp-remote` and Claude.ai's native connector can discover the flow without manual endpoint configuration:

- `GET /.well-known/oauth-protected-resource[<path>]` (RFC 9728): identifies this server as a protected resource and points at your `OIDC_ISSUER` as the authorization server. The route follows `OIDC_RESOURCE`: with `https://host/http`, the canonical document is served at `/.well-known/oauth-protected-resource/http` (RFC 9728 section 3.1) and a root copy is also served at `/.well-known/oauth-protected-resource` for clients that skip the path-specific URL (e.g. Google Gemini, #473); the bare origin serves only the root path. The official MCP SDK tries the path-specific URL first and falls back to the root.
- `GET /.well-known/oauth-authorization-server` (RFC 8414, #285): the authorization server metadata (its `authorization_endpoint` / `token_endpoint` / `registration_endpoint`), re-served from your IdP's own OpenID discovery document. This is here because several clients look for it on the resource-server origin, and some IdPs (e.g. Authentik) do not expose it where those clients look. It is fetched once at startup and served verbatim, exposes only endpoints your IdP already publishes publicly, and requires no authentication (a client reads it before it has a token). No extra configuration is needed; it is absent when `AUTH_PROVIDER` is not `oidc`.

**Where the per-user budget ACL comes from.** By default the ACL is the `AUTH_BUDGET_ACL` map you maintain by hand. Since v0.10.x it can instead be derived from the Actual server's own per-file access list, so granting or revoking someone in Actual takes effect here without a config edit and a restart:

```bash
AUTH_BUDGET_ACL_SOURCE=actual   # default: static (the AUTH_BUDGET_ACL map)
AUTH_BUDGET_ACL_CLAIM=auto      # default: mirrors Actual's own claim precedence
```

**How the match works.** Actual does not store your IdP's `sub`. When a user logs in, Actual resolves their identity as the first non-empty of `preferred_username`, `login`, `email`, `id`, `sub`, saves that string as the user's `userName`, and generates its own unrelated UUID as `userId`. The ACL therefore matches your token against `userName`, using that same precedence. `AUTH_BUDGET_ACL_CLAIM=auto` (the default) does exactly this; set it to a single claim name to pin one instead.

Three things to know before enabling it:

- **It requires a multi-user Actual server**, meaning one configured with `ACTUAL_OPENID_*`. On a password-only server no named users exist and every principal resolves to nothing.
- **Your Actual server must have been bootstrapped with a PASSWORD before OpenID was added.** This is a hard prerequisite of this MCP server generally, not just of this feature: `@actual-app/api` authenticates with a password, and an Actual server set up with OpenID from scratch refuses password login, so this server cannot connect to it at all. A password cannot be added afterwards.
- **The identity is only as trustworthy as the claim behind it.** OIDC guarantees that `sub` is unique and never reassigned; `preferred_username` and `email` carry no such guarantee and are often editable by the user. This exposure is inherited from Actual, which keys its own accounts the same way, not introduced here: anyone who can set their `preferred_username` to yours can impersonate you in Actual's login too. If that matters to you, pin `AUTH_BUDGET_ACL_CLAIM` to a claim your IdP does not let users edit, and make sure that is the claim your IdP uses to populate Actual's `user_name`.

It is opt-in and fails closed: if the budget list cannot be read, or the principal matches no file, access is denied rather than granted.

See [OIDC multi-user setup](docs/guides/authentication.md#oidc-multi-user-setup) for `AUTH_BUDGET_ACL` format, Casdoor notes, and the Cloudflare Access for SaaS + Gemini recipe.

---

## Testing

| Command | What It Tests | Requires Live Server |
|---------|---------------|---------------------|
| `npm run build` | TypeScript compilation | No |
| `npm run test:unit-js` | 84-tool smoke, schema validation, auth ACL | No |
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
| [docs/README.md](docs/README.md) | Index of every documentation page |
| [docs/guides/clients/README.md](docs/guides/clients/README.md) | **Start here** to connect a client: one page each for Claude Desktop, Claude Code, Cursor, VS Code (Copilot), Gemini CLI, Codex, LibreChat and LobeChat |
| [docs/guides/deployment.md](docs/guides/deployment.md) | Docker, Docker Compose profiles, production config, Kubernetes |
| [docs/guides/authentication.md](docs/guides/authentication.md) | HTTP auth modes and which budgets each one reaches |
| [docs/guides/multiple-budgets.md](docs/guides/multiple-budgets.md) | Configuring and switching between several budgets |
| [docs/guides/upgrading.md](docs/guides/upgrading.md) | Upgrade steps, requirements, breaking changes |
| [docs/guides/troubleshooting.md](docs/guides/troubleshooting.md) | Common symptoms, causes and fixes |
| [docs/reference/configuration.md](docs/reference/configuration.md) | Every environment variable |
| [docs/explanation/architecture.md](docs/explanation/architecture.md) | Component layers, data flow, transport protocols |
| [docs/explanation/security-and-privacy.md](docs/explanation/security-and-privacy.md) | Auth models, threat model, hardening |
| [docs/development/testing-and-reliability.md](docs/development/testing-and-reliability.md) | Test strategy, coverage, reliability patterns |
| [docs/development/new-tool-checklist.md](docs/development/new-tool-checklist.md) | Step-by-step guide for adding a new MCP tool |
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

Every Actual API call goes through the `withActualApi()` wrapper in `src/lib/actual-adapter.ts`, which handles init/shutdown lifecycle, retry (3 attempts, exponential backoff), and concurrency limiting. See [docs/explanation/architecture.md](docs/explanation/architecture.md) for full design documentation.

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

See [.github/SUPPORT.md](.github/SUPPORT.md) for where to ask a question, report a bug or report a vulnerability. Issues are tracked on [GitHub](https://github.com/agigante80/actual-mcp-server/issues).

---

**Version:** 0.24.14 | **Tool Count:** 84 (verified LibreChat-compatible)

## Sponsor

I build and maintain this in my own time. It is free, it stays free, and it gets maintained either way.

If it saved you some time and you feel like saying thanks, you can do that at [github.com/sponsors/agigante80](https://github.com/sponsors/agigante80). Entirely optional, and nothing about the project changes either way.
