# Nginx Reverse Proxy Setup for Actual MCP Server

This configuration adds an nginx reverse proxy in front of the Actual MCP Server to reduce SSE reconnect frequency and improve connection stability.

## Architecture

```
LibreChat → nginx (port 3600) → actual-mcp-server-backend (internal port 3600)
```

## Benefits

- **Reduced reconnects**: Nginx keepalive maintains connections for 10 minutes (600s)
- **Connection pooling**: Nginx reuses backend connections efficiently
- **Better timeout handling**: Proper SSE timeout configuration
- **Health checks**: Built-in health monitoring

## Configuration Files

### nginx.conf
- **Keepalive timeout**: 600s (10 minutes) - much longer than the default 65s
- **Proxy timeouts**: 600s for connect/send/read
- **SSE optimizations**: Buffering disabled, chunked transfer encoding
- **Connection pooling**: 32 keepalive connections to backend

### docker-compose.simple.yaml
Simple configuration with nginx proxy for production use.

Key changes from basic setup:
- `nginx-proxy` service exposed on port 3600
- `actual-mcp-server-backend` not directly exposed (internal only)
- Health checks for both services

## Usage

### Option 1: Simple Configuration (Recommended)

Use the simplified docker-compose file:

```bash
docker compose -f docker-compose.simple.yaml up -d
```

### Option 2: Main docker-compose.yaml

The main docker-compose.yaml already includes nginx configuration. Use:

```bash
docker compose up -d
```

## Environment Variables

No changes needed to your `.env` file. The nginx proxy is transparent.

## Monitoring

Check nginx logs:
```bash
docker logs actual-mcp-nginx
```

Check MCP server logs:
```bash
docker logs actual-mcp-server-backend
```

## LibreChat Configuration

Update your LibreChat MCP configuration to use the nginx proxy:

```json
{
  "mcpServers": {
    "actual-mcp": {
      "url": "http://actual-mcp-nginx:3600/http",
      "timeout": 600000
    }
  }
}
```

Or if accessing from host:
```json
{
  "mcpServers": {
    "actual-mcp": {
      "url": "http://localhost:3600/http",
      "timeout": 600000
    }
  }
}
```

**Important**: The `timeout` value (in milliseconds) should match nginx's keepalive:
- `600000` = 600 seconds = 10 minutes
- Default is often 60000 (60 seconds), which causes frequent reconnects

### LibreChat Environment Variables

You may also need to set these LibreChat environment variables to increase timeouts:

```env
# In LibreChat's .env file
MCP_TIMEOUT=600000
REQUEST_TIMEOUT=600000
```

## Expected Behavior

**Before nginx proxy:**
- SSE disconnects every ~52 seconds
- LibreChat reconnects with "SSE stream disconnected" errors
- Frequent session re-initialization

**After nginx proxy:**
- Connections stable for up to 10 minutes
- Much fewer reconnects in logs
- Smoother operation

## Troubleshooting

### Still seeing frequent reconnects?

1. Check nginx is running:
   ```bash
   docker ps | grep nginx
   ```

2. Verify nginx can reach backend:
   ```bash
   docker exec actual-mcp-nginx wget -O- http://actual-mcp-server-backend:3600/health
   ```

3. Check nginx configuration:
   ```bash
   docker exec actual-mcp-nginx nginx -t
   ```

### Connection refused errors?

Make sure backend service name matches in nginx.conf:
- nginx.conf uses: `actual-mcp-server-backend:3600`
- docker-compose service name: `actual-mcp-server-backend`

### Timeout still at 60s?

**This is the most common issue!** LibreChat has a default client-side timeout of 60 seconds.

**Solution**: Update LibreChat's MCP configuration:

1. Edit `librechat.yaml` (or your MCP config):
   ```yaml
   mcpServers:
     actual-mcp:
       url: "http://actual-mcp-nginx:3600/http"
       timeout: 600000  # 10 minutes in milliseconds
   ```

2. Or set environment variable:
   ```bash
   MCP_TIMEOUT=600000
   ```

3. Restart LibreChat:
   ```bash
   docker restart librechat
   ```

The timeout in LibreChat must be >= nginx's keepalive timeout (600s).

## Advanced: Custom Nginx Configuration

To modify nginx settings:

1. Edit `nginx.conf`
2. Reload nginx:
   ```bash
   docker exec actual-mcp-nginx nginx -s reload
   ```

Or restart the container:
```bash
docker restart actual-mcp-nginx
```

## Security Notes

- Nginx adds `X-Real-IP` and `X-Forwarded-For` headers
- MCP session IDs are preserved with `mcp-session-id` header
- Health endpoint is exposed on nginx for monitoring
- No authentication is added at nginx layer (handled by MCP server)
