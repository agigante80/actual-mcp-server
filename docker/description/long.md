# Actual MCP Server

A production-ready Model Context Protocol (MCP) bridge that exposes Actual Budget APIs as conversational AI tools for LibreChat, LobeChat, Claude Desktop, and any MCP-compatible client.

> **✅ Verified**: All 62 tools tested and working with LibreChat (HTTP/HTTPS + OIDC) and Claude Desktop (stdio native + mcp-remote).

## 🚀 Features

- **62 Implemented Tools** - Comprehensive coverage of the Actual Budget API (84% of methods)
- **6 Exclusive ActualQL Tools** - Advanced queries and summaries unique to this MCP server
- **HTTP + stdio Transports** - Run as a remote server for LibreChat/LobeChat (`--http`), or as a direct local process for Claude Desktop (`--stdio`) — no Docker or HTTP server needed for local use
- **Claude Desktop Native** - Connect without mcp-remote: spawn the server directly over stdin/stdout, zero config overhead
- **HTTPS Support** - Secure connections with native TLS or reverse-proxy termination
- **OIDC / JWT Auth** - Multi-user OIDC authentication with per-user budget ACL (Casdoor, Keycloak, etc.)
- **Multi-Budget Switching** - Configure multiple budgets and switch at runtime via `actual_budgets_switch`
- **Production-Grade** - Connection pooling (15 concurrent sessions), retry with exponential backoff, full test suite
- **Type-Safe** - Full TypeScript with Zod runtime validation
- **Secure** - Non-root container, secrets management, concurrency control
- **Dual Registry** - Available on Docker Hub and GitHub Container Registry (GHCR)

## 📦 Quick Start

### HTTP — Docker (for LibreChat / LobeChat)

```bash
docker run -d \
  --name actual-mcp-server \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL="http://your-actual-server:5006" \
  -e ACTUAL_PASSWORD="your-password" \
  -e ACTUAL_BUDGET_SYNC_ID="your-budget-id" \
  -e MCP_SSE_AUTHORIZATION="$(openssl rand -hex 32)" \
  -v actual-mcp-data:/data \
  agigante80/actual-mcp-server:latest

# Also available on GHCR:
# ghcr.io/agigante80/actual-mcp-server:latest
```

### stdio — Claude Desktop native (no Docker, no HTTP server, no token)

```bash
# 1. Clone and build once
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server && npm install && npm run build

# 2. Add to claude_desktop_config.json:
```

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/absolute/path/to/actual-mcp-server/dist/src/index.js", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here"
      }
    }
  }
}
```

> No auth token needed. All 62 tools available. Claude Desktop spawns the process and owns its lifecycle.

### HTTPS Setup (Recommended for LibreChat)

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -subj "/CN=YOUR_SERVER_IP" \
  -addext "subjectAltName=IP:YOUR_SERVER_IP"

docker run -d \
  --name actual-mcp-server \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL="http://your-actual-server:5006" \
  -e ACTUAL_PASSWORD="your-password" \
  -e ACTUAL_BUDGET_SYNC_ID="your-budget-id" \
  -e MCP_SSE_AUTHORIZATION="$(openssl rand -hex 32)" \
  -e MCP_ENABLE_HTTPS=true \
  -e MCP_HTTPS_CERT=/app/certs/cert.pem \
  -e MCP_HTTPS_KEY=/app/certs/key.pem \
  -v actual-mcp-data:/data \
  -v $(pwd)/certs:/app/certs:ro \
  agigante80/actual-mcp-server:latest
```

## 🔧 Configuration

### Required Environment Variables
- `ACTUAL_SERVER_URL` - Your Actual Budget server URL
- `ACTUAL_PASSWORD` - Actual Budget password
- `ACTUAL_BUDGET_SYNC_ID` - Budget sync ID (Settings → Show Advanced Settings → Sync ID)

### Server Configuration
- `MCP_BRIDGE_PORT` - Server port (default: 3600)
- `MCP_TRANSPORT_MODE` - Transport: `--http` or `--stdio`
- `MCP_SSE_AUTHORIZATION` - Bearer token for HTTP auth (generate with `openssl rand -hex 32`)

### HTTPS Configuration (Optional)
- `MCP_ENABLE_HTTPS` - Enable native TLS (true/false)
- `MCP_HTTPS_CERT` - Path to PEM certificate
- `MCP_HTTPS_KEY` - Path to PEM private key

### Multi-Budget Switching (Optional)

Configure multiple Actual Budget files so the AI can switch between them at runtime.

```bash
# Default budget
ACTUAL_SERVER_URL=http://actual:5006
ACTUAL_PASSWORD=my-password
ACTUAL_BUDGET_SYNC_ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
BUDGET_DEFAULT_NAME=Personal

# Budget 1 — same server
BUDGET_1_NAME=Family
BUDGET_1_SYNC_ID=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

# Budget 2 — separate server
BUDGET_2_NAME=Business
BUDGET_2_SERVER_URL=https://actual-office.example.com
BUDGET_2_PASSWORD=office-password
BUDGET_2_SYNC_ID=cccccccc-cccc-cccc-cccc-cccccccccccc
```

## 📚 Available Tools (62 Total)

### Account Management (7 tools)
create, list, update, delete, close, reopen, get balance

### Transaction Management (12 tools)
**Basic Operations (6):** create, get, update, delete, import, filter  
**⚡ Exclusive ActualQL Tools (6):** search by month/amount/category/payee, spending summary by category, top vendors analysis

### Budget Management (10 tools)
list available budgets, switch active budget, get all budgets, get months, get month, set amount, transfer between categories, set carryover, hold for next month, reset hold

### Category Management (8 tools)
create, list, update, delete (categories and category groups)

### Payee Management (6 tools)
create, list, update, delete, merge, get payee-specific rules

### Rules Management (4 tools)
create, list, update, delete

### Advanced Query & Sync (2 tools)
- **Custom ActualQL queries** - Execute advanced data queries
- **Bank sync** - Trigger GoCardless/SimpleFIN synchronization

### Batch Operations (1 tool)
Batch multiple budget updates in a single call

### Server Information (3 tools)
Server status + transport info, Actual Budget server version, name-to-UUID resolver

### Session Management (2 tools)
List active MCP sessions, close sessions by ID

## ⚡ Exclusive ActualQL Features

6 tools unique to this implementation using ActualQL's `$transform`, `groupBy`, `$sum`, and `$count`:

1. **Monthly Transaction Search** - Efficient monthly queries with `$month` transform
2. **Amount Range Search** - Find by amount with flexible filters
3. **Category Search** - Search by category name with date ranges
4. **Payee Search** - Find by vendor/merchant
5. **Category Spending Summary** - Aggregated totals grouped by category
6. **Top Vendors Analysis** - Highest-spending merchants with counts

## 🔗 AI Client Setup

### LibreChat / LobeChat (HTTP)

```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "https://YOUR_SERVER_IP:3600/http"
    headers:
      Authorization: "Bearer YOUR_TOKEN"
    serverInstructions: true
```

### Claude Desktop (stdio — native, recommended for local use)

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/path/to/actual-mcp-server/dist/src/index.js", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id"
      }
    }
  }
}
```

### Claude Desktop (mcp-remote via HTTP, when server already running)

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3600/http", "--header", "Authorization: Bearer YOUR_TOKEN"]
    }
  }
}
```

## 🛠️ Health & Status Checks

```bash
# HTTP health check
curl http://localhost:3600/health
# Expected: {"status":"ok","transport":"http","version":"..."}

# MCP handshake (verifies token)
curl -s -X POST http://localhost:3600/http \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Logs
docker logs actual-mcp-server
```

## 🔗 Container Registries

- **Docker Hub**: https://hub.docker.com/r/agigante80/actual-mcp-server
- **GHCR**: https://github.com/agigante80/actual-mcp-server/pkgs/container/actual-mcp-server

## 📖 Documentation

- **GitHub Repository**: https://github.com/agigante80/actual-mcp-server
- **Full README + Setup Guides**: https://github.com/agigante80/actual-mcp-server/blob/main/README.md
- **Claude Desktop Setup**: https://github.com/agigante80/actual-mcp-server/blob/main/docs/guides/CLAUDE_DESKTOP_SETUP.md
- **Actual Budget**: https://actualbudget.org

## 🔒 Security

- Runs as non-root user inside the container
- Multi-stage Docker build for minimal attack surface
- Secrets via environment variables or Docker secrets
- Rate limiting and concurrency control built-in
- OIDC/JWKS support for enterprise multi-user deployments

## 📝 License

MIT License — see GitHub repository for details
