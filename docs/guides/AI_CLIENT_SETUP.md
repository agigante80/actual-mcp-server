# AI Client Setup Guide

This guide covers connecting AI clients (LibreChat, LobeChat, or any MCP-compatible client) to the Actual MCP Server.

## Prerequisites

- Actual MCP Server running and reachable (see [Deployment Guide](DEPLOYMENT.md))
- Health check passing: `curl http://localhost:3600/health`
- A Bearer token configured if auth is enabled (`MCP_SSE_AUTHORIZATION`)

---

## Connection Architecture

```
┌─────────────┐   MCP/HTTP   ┌──────────────────┐   Actual API   ┌──────────────┐
│  AI Client  │ ◄──────────► │  Actual MCP      │ ◄───────────► │   Actual     │
│ (LibreChat  │              │  Server          │               │   Budget     │
│  LobeChat)  │              │  (62 tools)      │               │   Server     │
└─────────────┘              └──────────────────┘               └──────────────┘
```

The AI client communicates with the MCP server over **HTTP** using the JSON-RPC 2.0 protocol. The MCP server translates natural language tool calls into Actual Budget API requests.

---

## Docker Networking: Internal Hostnames

**When both the AI client and MCP server run in Docker**, always use **internal container hostnames** — not host IP addresses.

| | URL |
|---|---|
| ✅ Correct | `http://actual-mcp-server-backend:3600/http` |
| ❌ Avoid | `http://192.168.1.x:3600/http` |

**Why internal hostnames are better:**
- Direct container-to-container communication (no host bridge hop)
- Resilient to host IP changes
- No external network exposure
- Lower latency

Both containers must share the same Docker network. See [network configuration](#docker-network-configuration) below.

---

## LibreChat Setup

Edit your `librechat.yaml`:

```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    # Use container hostname if on same Docker network, otherwise use host IP/domain
    url: "http://actual-mcp-server-backend:3600/http"
    headers:
      Authorization: "Bearer YOUR_TOKEN_HERE"
    serverInstructions: true
    timeout: 600000  # 10 minutes (budget operations can be slow)
```

Then restart LibreChat:

```bash
docker restart ai-librechat
```

Verify tools loaded — in the LibreChat UI you should see **62 tools** listed under the MCP server entry.

### LibreChat with OIDC

When `AUTH_PROVIDER=oidc` is set on the MCP server, configure the OIDC MCP instance via the LibreChat admin UI (OAuth flow). For a static-token fallback, add to `librechat.yaml`:

```yaml
mcpServers:
  actual-bearer:
    type: "http"
    url: "http://actual-mcp-server-backend:3600/http"
    headers:
      Authorization: "Bearer your_token_here"
    serverInstructions: false
```

---

## LobeChat Setup

In the LobeChat UI:

1. Navigate to **Settings** → **Language Model** → **Model Context Protocol**
2. Click **Add Plugin**
3. Fill in:
   - **Name**: `Actual Budget MCP`
   - **Server Type**: `HTTP`
   - **Server URL**: `http://actual-mcp-server-backend:3600/http`
   - **Authorization**: `Bearer YOUR_TOKEN_HERE`
4. Click **Save**

LobeChat will automatically discover all 62 tools.

---

## Docker Network Configuration

Both the MCP server and AI client containers must be on the same Docker network:

```yaml
# docker-compose.yml
networks:
  ai-network:
    driver: bridge

services:
  librechat:           # or lobe-chat
    networks:
      - ai-network

  actual-mcp-server-backend:
    image: ghcr.io/agigante80/actual-mcp-server:latest
    networks:
      - ai-network
    environment:
      - ACTUAL_SERVER_URL=http://actual-server:5006
      - ACTUAL_PASSWORD=${ACTUAL_PASSWORD}
      - ACTUAL_BUDGET_SYNC_ID=${ACTUAL_BUDGET_SYNC_ID}
      - MCP_SSE_AUTHORIZATION=${MCP_SSE_AUTHORIZATION}
    volumes:
      - actual-mcp-data:/data
```

Verify connectivity from the AI client container:

```bash
docker exec <ai-container> wget -qO- http://actual-mcp-server-backend:3600/health
# Expected: {"status":"ok","initialized":true,...}
```

---

## HTTPS / TLS Setup

HTTPS is **not required** for internal Docker-to-Docker communication. Use it only if:
- The AI client accesses the MCP server from outside the Docker network
- You are exposing the server to the internet
- Compliance requirements mandate encryption

> **Note:** Native TLS is not yet implemented in the MCP server. Terminate TLS at a reverse proxy and set `MCP_BRIDGE_USE_TLS=true` so the server advertises `https://` in its URL.

### Option A: Docker Internal Network (Recommended — No HTTPS Needed)

If both containers share a Docker network, HTTP is sufficient. Internal Docker traffic does not leave the host machine.

### Option B: Reverse Proxy with TLS (External Access)

Run any reverse proxy (nginx, Caddy, Traefik) to terminate TLS, forwarding to the MCP server's HTTP port.

**Example: Caddy**

```
actual-mcp.yourdomain.com {
    reverse_proxy localhost:3600
}
```

**Example: nginx**

```nginx
server {
    listen 443 ssl;
    server_name actual-mcp.yourdomain.com;
    ssl_certificate     /etc/letsencrypt/live/actual-mcp.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/actual-mcp.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3600;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Set `MCP_BRIDGE_USE_TLS=true` in your `.env` so the MCP server advertises `https://` in its URL. Then update your AI client config to use `https://`:

```yaml
# LibreChat
url: "https://actual-mcp.yourdomain.com/http"
```

### Option C: Let's Encrypt (Production)

```bash
sudo certbot certonly --standalone -d actual-mcp.yourdomain.com
```

---

## OIDC Authentication (Multi-User)

For multi-user deployments with an OIDC provider (Casdoor, Keycloak, Auth0, etc.):

```bash
# .env
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://sso.yourdomain.com
OIDC_RESOURCE=your-client-id          # must match 'aud' claim in JWT
OIDC_SCOPES=                          # leave empty for Casdoor (no 'scope' claim)
```

**Per-user budget access control** (`AUTH_BUDGET_ACL`):

```bash
# Restrict which budgets each user can access
# Format: JSON object, principal → list of sync IDs or ["*"] for all
AUTH_BUDGET_ACL={"alice@example.com":["budget-uuid-1"],"group:admins":["*"]}
```

Principal key formats:
- `"alice@example.com"` — matches the `email` claim
- `"some-sub-uuid"` — matches the `sub` claim
- `"group:admin"` — matches an element in `groups` or `roles` array

**Casdoor note**: Casdoor JWTs do not include a `scope` claim. Set `OIDC_SCOPES=` (empty string) to disable scope enforcement.

---

## Verification

After connecting an AI client, verify:

```bash
# 1. Health check
curl http://localhost:3600/health
# Expected: {"status":"ok","initialized":true,...}

# 2. Tools loaded (should list 62 tools)
curl -s -X POST http://localhost:3600/http \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import json,sys; data=json.load(sys.stdin); print(f'{len(data[\"result\"][\"tools\"])} tools loaded')"
```

In your AI client you should see:
- ✅ 62 tools loaded with `actual_` prefix
- ✅ `actual_server_info` tool available
- ✅ Natural language queries returning results

### Tested Configurations

| Configuration | Result | Tools Loaded |
|---|---|---|
| HTTP, no auth | ✅ | 62 |
| HTTP + Bearer token | ✅ | 62 |
| HTTP + OIDC (Casdoor v2.13) | ✅ | 62 |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Tools don't load in AI client | Wrong URL or network | Verify `curl` health check works from the AI container |
| `401 Unauthorized` | Token mismatch | Check `MCP_SSE_AUTHORIZATION` matches `Authorization: Bearer <token>` |
| Timeout errors | Slow Actual Budget server | Increase `timeout` in client config (default: 10 min) |
| `connection refused` | MCP server not running | Check `docker logs actual-mcp-server-backend` |
| 0 tools loaded | Wrong transport type | Ensure `type: "streamable-http"` (not `"sse"`) in LibreChat config |
