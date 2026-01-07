# LobeChat Compatibility Fix

## Problem

LobeChat was returning 0 tools when discovering the MCP server:

```json
{
  "api": [],
  "identifier": "actual-mcp-server",
  "meta": {
    "avatar": "MCP_AVATAR",
    "description": "actual-mcp-server MCP server has 0 tools, like \"undefined\"",
    "title": "actual-mcp-server"
  },
  "type": "mcp"
}
```

## Root Cause

LobeChat's MCP discovery has two problematic behaviors:

**Problem 1: Header Requirements**
- LobeChat uses `Accept: */*` or `Accept: application/json` during discovery
- MCP SDK requires BOTH `application/json` AND `text/event-stream`
- Result: "Not Acceptable" error ❌

**Problem 2: Session Caching**
- LobeChat caches session IDs between requests
- After server restart, cached session ID is invalid
- LobeChat still sends the old session ID with `tools/list` requests
- Result: "Session expired or invalid" error ❌

The HAR file you provided shows Problem 2: LobeChat sent session ID `d6b66cf0-ab2a-4cfb-9bc2-d652631a3953` which didn't exist in the restarted container.

## Solution

Added special handling for `tools/list` in two scenarios:

### Scenario 1: No Session ID (Discovery Phase)
Lines 220-257 in src/server/httpServer.ts - When LobeChat first discovers the MCP server without any session.

### Scenario 2: Invalid/Expired Session ID (Cached Session)
Lines 337-367 in src/server/httpServer.ts - When LobeChat sends a cached session ID that's no longer valid (e.g., after server restart).

```typescript
// Special handling for tools/list without session (LobeChat compatibility)
if (!sessionId && method === 'tools/list') {
  logger.debug('[LOBECHAT COMPAT] Handling tools/list without session directly');
  // ... return tools directly ...
}

// Also handle tools/list with invalid session ID (LobeChat caches session IDs)
if (!transport && method === 'tools/list') {
  logger.debug('[LOBECHAT COMPAT] Handling tools/list with invalid session directly');
  // ... return tools directly ...
}
```

Both cases bypass the MCP SDK transport and return the tools list directly, allowing LobeChat to work with any Accept header and any session state.

## Testing

### Test 1: LobeChat-style Discovery (Accept: */*)

```bash
curl -X POST http://localhost:3600/http \
  -H "Content-Type: application/json" \
  -H "Accept: */*" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Result**: ✅ Returns 51 tools

### Test 2: LobeChat-style Discovery (Accept: application/json)

```bash
curl -X POST http://localhost:3600/http \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Result**: ✅ Returns 51 tools

### Test 3: LobeChat with Cached (Invalid) Session

```bash
curl -X POST http://localhost:3600/http \
  -H "Content-Type: application/json" \
  -H "Accept: */*" \
  -H "Authorization: Bearer TOKEN" \
  -H "mcp-session-id: old-invalid-session-id" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Result**: ✅ Returns 51 tools (instead of error)

### Test 4: LibreChat Full Flow Still Works

```bash
node tests/test-mcp-query.mjs
```

**Result**: ✅ All 7 tests passing
- Initialize with session ID ✅
- Query execution ✅
- Error handling ✅
- Validation ✅

### Test 5: Automated LobeChat Simulation

```bash
node test-lobechat-discovery.mjs
```

**Result**: ✅ Both discovery methods work

## Compatibility Matrix

| Client | Flow | Status |
|--------|------|--------|
| LibreChat | initialize → tools/list (with session) | ✅ Working |
| LobeChat | tools/list (no session, Accept: */*) | ✅ **FIXED** |
| LobeChat | tools/list (no session, Accept: application/json) | ✅ **FIXED** |
| Claude Desktop | initialize → tools/list (with session) | ✅ Working |

## Implementation Details

### Why Not Fix the Middleware?

Attempted to fix the `Accept` header middleware, but:
- Modifying `req.headers.accept` doesn't affect `req.get('Accept')`
- MCP SDK checks headers before middleware runs or in an intercepted way
- Direct response is simpler and more reliable

### Why This Approach Works

1. **No Session Needed**: LobeChat doesn't need a full MCP session just to discover tools
2. **Header Agnostic**: We control the response format, so Accept header doesn't matter
3. **SDK Bypass**: Avoiding the MCP SDK transport for discovery eliminates header requirements
4. **Backwards Compatible**: LibreChat still uses the full session-based flow

### Security Considerations

- ✅ Still requires authentication (Bearer token)
- ✅ Only exposes tool metadata (names, descriptions, schemas)
- ✅ No actual tool execution without proper session
- ✅ Same tools list as authenticated session would get

## Files Modified

- `src/server/httpServer.ts` - Added LobeChat discovery handler

## Expected LobeChat Response

Now LobeChat should show:

```json
{
  "api": [
    "actual_accounts_close",
    "actual_accounts_create",
    "actual_accounts_delete",
    ... (48 more tools)
  ],
  "identifier": "actual-mcp-server",
  "meta": {
    "avatar": "MCP_AVATAR",
    "description": "actual-mcp-server MCP server has 51 tools, like \"actual_accounts_close\"",
    "title": "actual-mcp-server"
  },
  "type": "mcp"
}
```

## Deployment Status

✅ **Built**: TypeScript compiled successfully  
✅ **Synced**: Code synced to Docker local-build  
✅ **Deployed**: Container rebuilt and restarted  
✅ **Tested**: Both LobeChat and LibreChat flows verified working

---

**Status**: COMPLETE ✅  
**Date**: January 7, 2026  
**Issue**: LobeChat returning 0 tools  
**Solution**: Direct tools/list handling for discovery phase
