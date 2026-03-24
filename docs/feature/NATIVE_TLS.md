# Native TLS / HTTPS

**Status:** Implemented — v0.4.29
**Priority:** 🟡 Medium
**Effort:** ~2 days

---

## Overview

The MCP server can terminate TLS natively without a reverse proxy. Set `MCP_ENABLE_HTTPS=true` together with paths to a certificate and private key file to start an HTTPS listener instead of plain HTTP.

## Configuration

```bash
MCP_ENABLE_HTTPS=true
MCP_HTTPS_CERT=/app/certs/cert.pem   # path to PEM certificate
MCP_HTTPS_KEY=/app/certs/key.pem     # path to PEM private key
```

The server validates at startup that both paths are set and the files exist. If either is missing it logs an error and exits immediately.

## Certificate Options

**Self-signed** (development / testing):
```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 \
  -subj "/CN=localhost"
```

**Let's Encrypt** (production):
```bash
certbot certonly --standalone -d your-domain.com
# cert: /etc/letsencrypt/live/your-domain.com/fullchain.pem
# key:  /etc/letsencrypt/live/your-domain.com/privkey.pem
```

## Implementation Notes

- `src/server/httpServer.ts`: when `MCP_ENABLE_HTTPS=true`, creates `https.createServer({ cert, key }, app)` instead of `app.listen()`; uses built-in `node:https` and `node:fs` — no new npm dependencies
- `src/index.ts`: startup validation exits with a clear error if cert/key paths are missing or unreadable; `MCP_ENABLE_HTTPS=true` is treated equivalently to `MCP_BRIDGE_USE_TLS=true` for scheme detection in the advertised URL
- Keep-alive timeouts (`keepAliveTimeout`, `headersTimeout`) apply to both HTTP and HTTPS since both return a `net.Server`

## Notes

A reverse proxy (Nginx, Caddy, Traefik) is still the preferred approach for production deployments that need certificate rotation, SNI, or multiple domains. The Docker Compose `production` profile provides an Nginx proxy out of the box. Native TLS is most useful for simple single-host deployments where adding a proxy is unnecessary overhead.

## References

- [`src/config.ts`](../../src/config.ts) — env var definitions (`MCP_ENABLE_HTTPS`, `MCP_HTTPS_CERT`, `MCP_HTTPS_KEY`)
- [`src/server/httpServer.ts`](../../src/server/httpServer.ts) — HTTPS server setup
- [`src/index.ts`](../../src/index.ts) — startup validation and scheme detection
- [`docker-compose.yaml`](../../docker-compose.yaml) — `production` profile (Nginx TLS termination, recommended for multi-domain/rotation)
