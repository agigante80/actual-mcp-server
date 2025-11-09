# SSE Authentication Guide

This guide explains how to configure authentication for SSE (Server-Sent Events) connections to the Actual MCP Server.

## Overview

The Actual MCP Server supports optional authentication for SSE connections using Bearer tokens. When enabled, all SSE connections (both GET for stream establishment and POST for client messages) must include a valid Authorization header.

## Configuration

### 1. Generate a Secure Token

Generate a strong random token for production use:

```bash
# Using openssl (recommended)
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Set the Environment Variable

Add the token to your `.env` file:

```bash
MCP_SSE_AUTHORIZATION=your-secure-token-here
```

**Important:** Keep this token secret! Anyone with this token can connect to your MCP server.

### 3. Authentication Behavior

- **When `MCP_SSE_AUTHORIZATION` is set:** All SSE requests must include the Authorization header
- **When `MCP_SSE_AUTHORIZATION` is not set:** Authentication is disabled (open access)

## Client Configuration

### LibreChat Configuration

Update your LibreChat `librechat.yaml` to include the authorization header:

```yaml
mcpServers:
  actual-mcp:
    type: "sse"
    url: "http://your-server:3600/sse"
    headers:
      Authorization: "Bearer your-secure-token-here"
    serverInstructions: true
```

### Custom Clients

When connecting from custom clients, include the Authorization header in both GET and POST requests:

```javascript
// Example using fetch
const response = await fetch('http://your-server:3600/sse', {
  headers: {
    'Authorization': 'Bearer your-secure-token-here'
  }
});
```

## Docker Configuration

### Development Mode

Uncomment the `MCP_SSE_AUTHORIZATION` line in `docker-compose.yaml`:

```yaml
services:
  mcp-server-dev:
    environment:
      # SSE Authentication (optional - leave commented for no auth)
      - MCP_SSE_AUTHORIZATION=${MCP_SSE_AUTHORIZATION}
```

### Production Mode

For production, use Docker secrets for better security:

1. Create a secret file:
```bash
echo "your-secure-token-here" > mcp_sse_token.txt
```

2. Update `docker-compose.yaml`:
```yaml
services:
  mcp-server-prod:
    environment:
      - MCP_SSE_AUTHORIZATION_FILE=/run/secrets/mcp_sse_token
    secrets:
      - mcp_sse_token

secrets:
  mcp_sse_token:
    file: ./mcp_sse_token.txt
```

3. Update `src/config.ts` to read from file if `_FILE` suffix is used (similar to `ACTUAL_PASSWORD_FILE`).

## Testing Authentication

### Test Without Token (Should Fail)

```bash
curl -v http://localhost:3600/sse
# Expected: 401 Unauthorized
```

### Test With Valid Token (Should Succeed)

```bash
curl -v -H "Authorization: Bearer your-secure-token-here" http://localhost:3600/sse
# Expected: 200 OK with SSE stream
```

### Test With Invalid Token (Should Fail)

```bash
curl -v -H "Authorization: Bearer wrong-token" http://localhost:3600/sse
# Expected: 401 Unauthorized
```

## Server Logs

When authentication is enabled, the server logs will show:

```
🌐 SSE MCP server listening on http://localhost:3600/sse
🔒 SSE authentication enabled (Bearer token required)
```

When authentication is disabled:

```
🌐 SSE MCP server listening on http://localhost:3600/sse
⚠️  SSE authentication disabled (no MCP_SSE_AUTHORIZATION set)
```

Failed authentication attempts are logged:

```
[SSE] Unauthorized request from 172.21.0.6: Invalid token
```

## Security Best Practices

1. **Always enable authentication in production**
2. **Use strong random tokens** (minimum 32 characters)
3. **Rotate tokens regularly** (e.g., every 90 days)
4. **Use HTTPS/TLS** for connections over the internet
5. **Restrict network access** using firewalls
6. **Monitor logs** for unauthorized access attempts
7. **Use Docker secrets** in production, not environment variables

## Troubleshooting

### Client Cannot Connect

1. **Check token matches:** Ensure the token in client config matches server config exactly
2. **Check header format:** Must be `Authorization: Bearer <token>` (note the space after "Bearer")
3. **Check server logs:** Look for authentication error messages
4. **Verify environment variable:** Use `printenv | grep MCP_SSE` to check if set

### Token Not Working

1. **Remove quotes:** Don't wrap the token in quotes in `.env` file
2. **Check for whitespace:** Tokens should not have leading/trailing whitespace
3. **Restart server:** Changes to environment variables require server restart

### Still Getting 401 Errors

1. **Check case sensitivity:** "Bearer" must be capitalized correctly
2. **Verify POST requests:** Both GET and POST to `/sse` need the header
3. **Check LibreChat version:** Older versions may not support custom headers

## Example: Full Setup with LibreChat

1. **Generate token:**
   ```bash
   openssl rand -hex 32
   # Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
   ```

2. **Configure MCP Server (`.env`):**
   ```bash
   MCP_SSE_AUTHORIZATION=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
   ```

3. **Configure LibreChat (`librechat.yaml`):**
   ```yaml
   mcpServers:
     actual-mcp:
       type: "sse"
       url: "http://192.168.1.100:3600/sse"
       headers:
         Authorization: "Bearer a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"
       serverInstructions: true
   ```

4. **Start services:**
   ```bash
   # Start MCP server
   npm run dev -- --sse
   
   # Restart LibreChat
   docker compose restart
   ```

5. **Verify connection:**
   Check LibreChat logs for successful MCP initialization:
   ```
   [MCP][actual-mcp] Initialized in: 10262ms
   MCP servers initialized successfully. Added 39 MCP tools.
   ```

## Additional Resources

- [MCP Protocol Documentation](https://modelcontextprotocol.io/)
- [SSE (Server-Sent Events) Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [LibreChat MCP Configuration](https://docs.librechat.ai/)
