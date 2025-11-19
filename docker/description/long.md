# Actual MCP Server

A production-ready Model Context Protocol (MCP) bridge that exposes Actual Budget APIs as conversational AI tools for LibreChat and other MCP-compatible clients.

> **✅ LibreChat Verified**: All 42 tools tested and working with LibreChat over HTTPS with Bearer token authentication.

## 🚀 Features

- **42 Implemented Tools** - Comprehensive coverage of core Actual Budget API
- **Advanced Features** - Custom ActualQL queries, bank sync, multi-budget support
- **HTTPS Support** - Secure connections with self-signed or CA certificates
- **LibreChat Ready** - Tested and verified with all 42 tools loading successfully
- **Multiple Transports** - HTTP, SSE (Server-Sent Events) with authentication
- **Production-Grade** - Retry logic, concurrency control, observability
- **Type-Safe** - Full TypeScript implementation with generated types
- **Secure** - Non-root container, secrets management, rate limiting
- **Dual Registry** - Available on Docker Hub and GitHub Container Registry (GHCR)

## 📦 Quick Start

### Basic HTTP Setup

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
  
# Note: HTTP transport is the default. To use SSE instead:
# -e MCP_TRANSPORT_MODE=--sse  (Server-Sent Events)

# Or use GitHub Container Registry
docker run -d ... ghcr.io/agigante80/actual-mcp-server:latest
```

### HTTPS Setup (Recommended for LibreChat)

```bash
# Generate self-signed certificate
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -subj "/CN=YOUR_SERVER_IP" \
  -addext "subjectAltName=IP:YOUR_SERVER_IP"

# Run with HTTPS
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
- `ACTUAL_BUDGET_SYNC_ID` - Budget sync ID

### Server Configuration
- `MCP_BRIDGE_PORT` - Server port (default: 3600)
- `MCP_TRANSPORT_MODE` - Transport protocol: --http (default) or --sse
- `MCP_SSE_AUTHORIZATION` - Bearer token for authentication (generate with `openssl rand -hex 32`)

### HTTPS Configuration (Optional but Recommended)
- `MCP_ENABLE_HTTPS` - Enable HTTPS (true/false, default: false)
- `MCP_HTTPS_CERT` - Path to SSL certificate (default: /app/certs/cert.pem)
- `MCP_HTTPS_KEY` - Path to SSL private key (default: /app/certs/key.pem)

## 📚 Available Tools (42 Total)

### Account Management (7 tools)
create, list, update, delete, close, reopen, get balance

### Transaction Management (6 tools)
create, get, update, delete, import, filter

### Budget Management (8 tools)
get all budgets, get months, get month, set amount, transfer between categories, set carryover, hold for next month, reset hold

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
Batch multiple budget updates in a single transaction

## 🔗 Container Registries

- **Docker Hub**: https://hub.docker.com/r/agigante80/actual-mcp-server
- **GitHub Container Registry**: https://github.com/agigante80/actual-mcp-server/pkgs/container/actual-mcp-server

## 📖 Documentation & Links

- **GitHub Repository**: https://github.com/agigante80/actual-mcp-server
- **Full Documentation**: https://github.com/agigante80/actual-mcp-server/blob/main/README.md
- **LibreChat Integration Guide**: See README for detailed HTTPS setup instructions
- **Actual Budget**: https://actualbudget.org

## 🛠️ Health & Status Checks

```bash
# HTTP
curl http://localhost:3600/health

# HTTPS (with self-signed cert)
curl -k https://localhost:3600/health

# Check logs
docker logs actual-mcp-server
# Should show: "🚀 Actual MCP Server v0.1.0"
```

## 🤖 LibreChat Integration

1. Generate HTTPS certificates (self-signed or CA-signed)
2. Run container with HTTPS enabled
3. Configure LibreChat with:
   ```json
   {
     "actualMcpServer": {
       "url": "https://YOUR_SERVER_IP:3600",
       "transport": "http",
       "headers": {
         "Authorization": "Bearer YOUR_TOKEN"
       }
     }
   }
   ```
4. All 42 tools will load automatically

**Verified**: HTTP transport with Bearer token authentication works perfectly with LibreChat.

## 📊 Monitoring

Prometheus metrics available at `/metrics` endpoint for observability and performance tracking.

## 🔒 Security

- Runs as non-root user
- Multi-stage Docker build for minimal attack surface
- Secrets via environment variables or Docker secrets
- Rate limiting and concurrency control built-in

## 📝 License

MIT License - see GitHub repository for details
