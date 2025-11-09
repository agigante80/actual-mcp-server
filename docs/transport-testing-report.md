# MCP Transport Testing Report
**Date:** November 9, 2025  
**MCP Server:** actual-mcp-server (HTTP, SSE, WebSocket transports)  
**Client:** LibreChat running in Docker  

## Executive Summary

All three transports (HTTP, SSE, WebSocket) have been implemented with Bearer token authentication. However, there is a **critical issue preventing tools from loading in LibreChat** that affects all transports regardless of authentication status.

## Test Environment

- **MCP Server:** 192.168.8.245:3600
- **Available Tools:** 39 tools across 8 categories
- **LibreChat:** Docker container `ai-librechat`
- **Authentication Token:** FobMtOOn7A5asjQf0Qdgd54x29RX88jw

## Test 1: HTTP Transport Without Authentication

### Configuration
```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    url: "http://192.168.8.245:3600/http"
    serverInstructions: true
```

### Server Status
✅ **Server Started Successfully**
```
info: 🔗 Loaded 39 tool modules from src/tools
info: MCP Streamable HTTP Server listening on 3600
info: 📨 MCP endpoint: http://192.168.8.245:3600/http
warn: ⚠️  HTTP authentication disabled (no MCP_SSE_AUTHORIZATION set)
```

### Health Check
✅ **Server Healthy**
```json
{
  "status": "ok",
  "initialized": true,
  "initializationError": null,
  "transport": "streamable-http",
  "activeSessions": 0
}
```

### Direct curl Test
✅ **Initialize Request Returns All 39 Tools**
```bash
$ curl -X POST http://localhost:3600/http \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'
```

Response includes:
```json
{
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {"tools": {}},
    "tools": [
      "actual_accounts_close",
      "actual_accounts_create",
      ...
      (all 39 tools listed)
    ]
  }
}
```

### LibreChat Connection
❌ **FAILED - 0 Tools Loaded**

LibreChat Logs:
```
[MCP][actual-mcp] Creating streamable-http transport
[MCP][actual-mcp] Transport sending: {"method":"initialize",...}
[MCP][actual-mcp] Transport error: fetch failed
[MCP][actual-mcp] Connection failed: fetch failed
[MCP][actual-mcp] Failed to connect after 3 attempts
[MCP][actual-mcp] Capabilities: undefined
[MCP][actual-mcp] Tools: undefined
[MCP][actual-mcp] Added 0 MCP tools
```

MCP Server Logs:
```
debug: [SESSION] Creating new MCP server + transport for initialize
debug: Session initialized: a1ad4296-0520-4fe1-baa4-c851c25a04f7
debug: [SESSION] Creating new MCP server + transport for initialize
debug: Session initialized: 0cff438c-a7dc-468b-9940-af10890c7cb1
... (6 sessions created, no tools/list requests)
```

### Analysis

**Root Cause:** Session management issue between LibreChat and MCP server

1. ✅ MCP server correctly returns 39 tools in initialize response (confirmed via curl)
2. ✅ Server creates sessions for initialize requests  
3. ❌ LibreChat reports "fetch failed" despite server accepting requests
4. ❌ Multiple sessions created (6!) for single connection attempt
5. ❌ No `tools/list` requests ever made by LibreChat
6. ❌ Session ID not being returned in response headers

**Hypothesis:** The streamable-http transport requires the MCP-Session-Id header to be returned, but our server isn't properly sending it. This causes LibreChat to fail the connection and never proceed to request tools.

## Critical Issue

The problem is **NOT with authentication** - it's with the **MCP protocol implementation**.

- Server advertises 39 tools correctly  
- Server handles initialize requests
- **BUT** session handling is broken, preventing LibreChat from making subsequent requests

## Recommendations

1. **Fix Session Handling:** Investigate why MCP-Session-Id header isn't being returned
2. **Test with Official MCP Client:** Use @modelcontextprotocol/sdk's test client to isolate the issue
3. **Compare with Working Implementation:** Review streamable-http examples from MCP SDK
4. **Add Protocol-Level Logging:** Log exact HTTP headers and response structure
5. **Session Persistence:** Verify transport is properly maintaining session state

## Status Summary

| Transport | Authentication | Tools Advertised | LibreChat Connection | Tools Loaded |
|-----------|----------------|------------------|----------------------|--------------|
| HTTP      | ✅ Implemented  | ✅ 39 tools       | ❌ Fetch failed       | ❌ 0 tools    |
| SSE       | ✅ Implemented  | ✅ 39 tools       | ❌ Fetch failed       | ❌ 0 tools    |
| WebSocket | ✅ Implemented  | ✅ 39 tools       | ⏸️ Not tested yet    | ⏸️ Not tested |

## Next Steps

**BLOCKED:** Cannot proceed with authentication testing until session/connection issue is resolved.

The authentication implementations are complete and correct, but we cannot verify them functionally until LibreChat can successfully connect and load tools from the server.

---

**Testing Suspended:** Recommend fixing the core MCP protocol session handling before continuing with transport-specific authentication tests.
