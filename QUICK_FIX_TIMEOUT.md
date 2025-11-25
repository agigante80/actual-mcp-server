# Quick Fix for LibreChat SSE Timeouts

## Problem
LibreChat disconnects from MCP server every ~60 seconds with:
```
error: [MCP][actual-mcp] Transport error: SSE stream disconnected: TypeError: terminated
```

## Root Cause
LibreChat has a default **60-second timeout** for MCP connections, which is shorter than nginx's 600-second keepalive.

## Solution

### Option 1: librechat.yaml (Recommended)

Edit your `librechat.yaml` and add/update the timeout:

```yaml
version: 1.0.0
cache: true

endpoints:
  agents:
    disableBuilder: false
    mcpServers:
      actual-mcp:
        url: "http://actual-mcp-nginx:3600/http"
        timeout: 600000  # ← ADD THIS: 10 minutes in milliseconds
```

### Option 2: Environment Variable

Add to LibreChat's `.env` file:

```bash
# MCP timeout in milliseconds (10 minutes)
MCP_TIMEOUT=600000
```

### Option 3: Docker Compose

Add to LibreChat service in docker-compose.yaml:

```yaml
  librechat:
    environment:
      - MCP_TIMEOUT=600000
```

## Verification

After applying the fix:

1. Restart LibreChat:
   ```bash
   docker restart librechat
   ```

2. Check logs - you should see:
   - **Before**: Reconnects every ~60 seconds
   - **After**: Reconnects every ~10 minutes (or longer if actively used)

3. Look for this pattern in logs:
   ```
   # Should be ~600 seconds apart instead of 60
   09:42:47 - Connection established
   09:52:47 - SSE stream disconnected  ← Should be 10 min later, not 60 sec
   ```

## Why This Happens

The architecture is:

```
LibreChat → nginx (600s keepalive) → MCP Server (65s keepalive)
   60s ↑
```

Even though nginx and MCP server have proper keepalives, **LibreChat's 60s client timeout** closes the connection first. Setting `timeout: 600000` fixes this.

## Note

The nginx proxy is still valuable because:
- It provides connection pooling to the backend
- It handles reconnects more gracefully
- It's ready for when LibreChat's timeout is configured correctly

Once you set the timeout, you'll see dramatically fewer reconnects!
