# Actual MCP Server

A production-ready Model Context Protocol (MCP) bridge that exposes Actual Finance APIs as conversational AI tools for LibreChat and other MCP-compatible clients.

## 🚀 Features

- **37 Implemented Tools** - 76% coverage of Actual Budget API
- **Multiple Transport Protocols** - HTTP, WebSocket, and SSE support
- **Production-Grade** - Retry logic, concurrency control, observability
- **Type-Safe** - Full TypeScript implementation with generated types
- **Secure** - Non-root container, secrets management, rate limiting

## 📦 Quick Start

```bash
docker run -d \
  -e ACTUAL_SERVER_URL="https://actual.example.com" \
  -e ACTUAL_PASSWORD="your-password" \
  -e ACTUAL_BUDGET_SYNC_ID="your-budget-id" \
  -e MCP_BRIDGE_HTTP_PORT=3000 \
  -p 3000:3000 \
  agigante80/actual-mcp-server:latest
```

## 🔧 Configuration

Environment variables:
- `ACTUAL_SERVER_URL` - Your Actual Budget server URL
- `ACTUAL_PASSWORD` - Actual Budget password
- `ACTUAL_BUDGET_SYNC_ID` - Budget sync ID
- `MCP_BRIDGE_HTTP_PORT` - Server port (default: 3000)
- `MCP_BRIDGE_USE_TLS` - Enable TLS (true/false)

## 📚 Available Tools

**Account Management:** create, list, update, delete, close, reopen, get balance
**Transaction Management:** create, list, update, delete, import
**Budget Management:** get months, set amount, set carryover, batch updates, hold for next month
**Category Management:** create, list, update, delete (groups and categories)
**Payee Management:** create, list, update, delete, merge, get rules
**Rules Management:** create, list, update, delete

## 🔗 Links

- GitHub: https://github.com/agigante80/actual-mcp-server
- Docker Hub: https://hub.docker.com/r/agigante80/actual-mcp-server
- Documentation: https://github.com/agigante80/actual-mcp-server/blob/main/README.md
- Actual Budget: https://actualbudget.org

## 🛠️ Health Check

```bash
curl http://localhost:3000/health
```

## 📊 Monitoring

Prometheus metrics available at `/metrics` endpoint.

## 🔒 Security

- Runs as non-root user
- Multi-stage Docker build for minimal attack surface
- Secrets via environment variables or Docker secrets
- Rate limiting and concurrency control built-in

## 📝 License

MIT License - see GitHub repository for details
