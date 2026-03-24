# Native TLS / HTTPS Support

**Status:** Planned — v0.5.x  
**Priority:** 🟡 Medium  
**Effort:** ~2 days  
**Blocker:** None

---

## Overview

Add native HTTPS support to the MCP server so that clients enforcing HTTPS (such as Claude Desktop) can connect without requiring a separate reverse proxy. The three env vars (`MCP_ENABLE_HTTPS`, `MCP_HTTPS_CERT`, `MCP_HTTPS_KEY`) are already parsed by `src/config.ts` but are currently no-ops — this feature wires them up.

---

## Problem

Claude Desktop (and future MCP clients) require `"url"` to start with `https://`. Currently the only workaround is a reverse proxy (nginx/Caddy), which is unnecessary overhead for local single-user installs.

---

## Scope

### 1. Certificate file mode (`MCP_HTTPS_CERT` + `MCP_HTTPS_KEY`)

User provides paths to PEM files:

```bash
MCP_ENABLE_HTTPS=true
MCP_HTTPS_CERT=/certs/cert.pem
MCP_HTTPS_KEY=/certs/key.pem
```

In `src/server/httpServer.ts`, replace `app.listen()` with:

```typescript
import https from 'node:https';
import fs from 'node:fs';

if (config.MCP_ENABLE_HTTPS && config.MCP_HTTPS_CERT && config.MCP_HTTPS_KEY) {
  const tlsOptions = {
    cert: fs.readFileSync(config.MCP_HTTPS_CERT),
    key:  fs.readFileSync(config.MCP_HTTPS_KEY),
  };
  https.createServer(tlsOptions, app).listen(port, ...);
} else {
  app.listen(port, ...);
}
```

`MCP_BRIDGE_USE_TLS` should automatically be treated as `true` when `MCP_ENABLE_HTTPS=true`, so the advertised URL uses `https://`.

### 2. Self-signed cert auto-generation fallback

When `MCP_ENABLE_HTTPS=true` but **no cert/key paths are provided**, auto-generate a self-signed certificate at startup using the [`selfsigned`](https://www.npmjs.com/package/selfsigned) npm package:

```typescript
import selfsigned from 'selfsigned';

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048 });
// pems.cert, pems.private
```

> ⚠️ Self-signed certs work for local dev but Claude Desktop may show a security warning or refuse the cert. For Claude Desktop, generating a locally-trusted cert with `mkcert` and mounting it is preferred.

### 3. Docker volume mount for certs

Add a `certs` volume to `docker-compose.yaml` examples:

```yaml
volumes:
  - ./certs:/certs:ro
environment:
  - MCP_ENABLE_HTTPS=true
  - MCP_HTTPS_CERT=/certs/cert.pem
  - MCP_HTTPS_KEY=/certs/key.pem
```

### 4. `mkcert` workflow for local dev (Claude Desktop)

```bash
# Install mkcert (once)
# macOS: brew install mkcert && mkcert -install
# Linux: see https://github.com/FiloSottile/mkcert#linux

# Generate a locally-trusted cert for localhost
mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1

# Place in Docker certs volume
mkdir -p ~/docker/librechat-MCP-actual/actual-mcp-server/certs
cp cert.pem key.pem ~/docker/librechat-MCP-actual/actual-mcp-server/certs/
```

Claude Desktop config with HTTPS:

```json
{
  "mcpServers": {
    "actual-budget": {
      "type": "http",
      "url": "https://localhost:3601/http",
      "headers": {
        "Authorization": "Bearer your_secret_token"
      }
    }
  }
}
```

---

## New Dependencies

```bash
npm install selfsigned
npm install --save-dev @types/selfsigned
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_ENABLE_HTTPS` | `false` | Enable native TLS. Set to `true` to activate. |
| `MCP_HTTPS_CERT` | — | Path to PEM certificate file. Optional — auto-generates self-signed if omitted. |
| `MCP_HTTPS_KEY` | — | Path to PEM private key file. Optional — auto-generates self-signed if omitted. |

> All three are already parsed in `src/config.ts`. Only wiring in `httpServer.ts` is needed.

---

## Implementation Checklist

- [ ] `src/server/httpServer.ts` — wrap `app.listen` with `https.createServer` when `MCP_ENABLE_HTTPS=true`
- [ ] `src/index.ts` — auto-set `MCP_BRIDGE_USE_TLS=true` when `MCP_ENABLE_HTTPS=true` (so advertised URL is `https://`)
- [ ] `src/server/httpServer.ts` — auto-generate self-signed cert via `selfsigned` when cert/key paths not provided
- [ ] `docker-compose.yaml` — add commented `certs` volume example
- [ ] `.env.example` — document `MCP_ENABLE_HTTPS`, `MCP_HTTPS_CERT`, `MCP_HTTPS_KEY`
- [ ] `README.md` — update TLS env var table rows (remove "not yet implemented")
- [ ] `docs/guides/CLAUDE_DESKTOP_SETUP.md` — add HTTPS setup section (mkcert workflow)
- [ ] `docs/guides/DEPLOYMENT.md` — add TLS section
- [ ] `docs/guides/AI_CLIENT_SETUP.md` — update HTTPS section to mention native TLS option
- [ ] Unit test — verify `https.createServer` is called when `MCP_ENABLE_HTTPS=true`
- [ ] Integration test — health check via `https://localhost:PORT/health`
- [ ] Delete this file and remove from `ROADMAP.md` when implementation ships

---

## Success Criteria

- Claude Desktop can connect to `https://localhost:3601/http` without a reverse proxy
- `MCP_ENABLE_HTTPS=true` with no cert paths starts with a self-signed cert and logs a warning
- `MCP_ENABLE_HTTPS=true` with valid cert/key paths serves proper TLS
- `MCP_ENABLE_HTTPS=false` (default) — zero behaviour change, all existing tests pass
- `npm audit` — no new vulnerabilities from `selfsigned` dep

---

## References

- [`src/config.ts`](../../src/config.ts) — env var schema (vars already defined)
- [`src/server/httpServer.ts`](../../src/server/httpServer.ts) — where `https.createServer` will be added
- [`docs/guides/CLAUDE_DESKTOP_SETUP.md`](../guides/CLAUDE_DESKTOP_SETUP.md) — Claude Desktop setup guide
- [`docs/guides/AI_CLIENT_SETUP.md`](../guides/AI_CLIENT_SETUP.md) — HTTPS/TLS proxy section (to be updated)
- [selfsigned npm package](https://www.npmjs.com/package/selfsigned)
- [mkcert](https://github.com/FiloSottile/mkcert) — locally-trusted dev certificates
