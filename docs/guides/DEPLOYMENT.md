# Deployment Guide

This guide covers all deployment methods for the Actual MCP Server.

---

## Prerequisites

- **Actual Budget server** running and accessible (local, Docker, or remote)
- Your **Budget Sync ID** from Actual: Settings → Show Advanced Settings → Sync ID
- **Node.js 22+** (for npm method) or **Docker** (for container methods)

---

## Method 1: npm (Local / Development)

```bash
# Clone repository
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env to set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID at minimum

# Build TypeScript
npm run build

# Run server
npm run dev -- --http --debug
```

The server starts at `http://localhost:3600/http` by default.

**Minimum `.env`:**

```bash
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your-sync-id-here
```

---

## Method 2: Docker (Recommended for Production)

### Quick Start

```bash
docker run -d \
  --name actual-mcp-server-backend \
  -p 3600:3600 \
  -e MCP_BRIDGE_PORT=3600 \
  # Use the same URL you type in your browser to open Actual Budget.
  # Examples:
  #   http://localhost:5006          - Actual Budget on the same machine
  #   http://192.168.1.50:5006       - Actual Budget on another machine on your network
  #   https://actual.yourdomain.com  - Actual Budget on a remote server with a domain
  #   http://actual:5006             - if both containers share a Docker network (use container service name)
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -v actual-mcp-data:/app/data \
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest

# Verify
curl http://localhost:3600/health
```

> **Note:** actual-mcp does not need to run on the same machine as Actual Budget. You can run Actual Budget on one server and actual-mcp on another - all that is needed is network access to `ACTUAL_SERVER_URL`.

### Image Registries

```bash
# GitHub Container Registry (primary)
ghcr.io/agigante80/actual-mcp-server:latest
ghcr.io/agigante80/actual-mcp-server:X.Y.Z   # pin a specific released version, e.g. 0.6.40

# Docker Hub (mirror)
agigante80/actual-mcp-server:latest
agigante80/actual-mcp-server:X.Y.Z
```

### Production docker run

```bash
# 1. Generate a strong token
TOKEN=$(openssl rand -hex 32)

# 2. Run the container (bind port only on localhost if behind a reverse proxy)
docker run -d \
  --name actual-mcp-server-backend \
  --restart unless-stopped \
  -p 127.0.0.1:3600:3600 \
  -e MCP_BRIDGE_PORT=3600 \
  -e ACTUAL_SERVER_URL=https://actual.yourdomain.com \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$TOKEN \
  -e MCP_BRIDGE_USE_TLS=true \
  -e MCP_BRIDGE_LOG_LEVEL=info \
  -e MCP_BRIDGE_STORE_LOGS=true \
  -e NODE_ENV=production \
  -v actual-mcp-data:/app/data \
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest

# 3. Verify
curl http://localhost:3600/health
```

---

## Method 3: Docker Compose

The repository ships `docker-compose.yaml` with three profiles.

### Clone and configure

```bash
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
cp .env.example .env
# Edit .env with your credentials
```

### Profiles

`docker-compose.yaml` defines two profiles:

| Profile | What it starts | Use case |
|---|---|---|
| `dev` | MCP server, mounts `src/` for hot-reload | Local development |
| `production` | MCP server only (resource limits, env-based config) | Production, single host |

There is no bundled reverse proxy or Actual Budget server in `docker-compose.yaml`. For a stack that also runs Actual Budget (used by the Docker E2E tests), see `docker-compose.test.yaml`. For a reverse proxy, a commented Traefik example is included near the bottom of `docker-compose.yaml`.

```bash
# Development (hot-reload source)
docker compose --profile dev up -d

# Production
docker compose --profile production up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**Default ports:**
- MCP server (HTTP): `3600`. Both the `dev` and `production` compose profiles set `MCP_BRIDGE_PORT=3600` and publish `3600:3600`.
- A standalone `docker run` of the image listens on whatever `MCP_BRIDGE_PORT` you set (the application default is `3600`). The image's `EXPOSE` and `HEALTHCHECK` also use `3600`, so a direct `docker run` is consistent out of the box: map `-p 3600:3600` and the healthcheck and your published port agree.

> **Upgrading from an earlier version?** The Compose profiles previously published the MCP server on host port `3000`; they now use `3600` to match the published image and all guides. If you reach the server on `3000` today, update your host mapping, reverse proxy, or client URL to `3600`. Your budget data is unaffected: the named volume and the host data directory are unchanged, only the in-container mount path moved from `/data` to `/app/data` together with `MCP_BRIDGE_DATA_DIR`, so the same files are still read.

### Production Compose deployment

```bash
# 1. Clone and configure
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
cp .env.example .env
# Set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID, MCP_SSE_AUTHORIZATION

# 2. Start production stack
docker compose --profile production up -d

# 3. Check logs
docker compose logs -f mcp-server-prod

# 4. Verify health
curl http://localhost:3600/health
```

---

## Environment: Required Variables

| Variable | Description |
|---|---|
| `ACTUAL_SERVER_URL` | URL of your Actual Budget server - use the same URL you type in your browser. `http://localhost:5006` (local), `http://192.168.1.x:5006` (network), `https://actual.yourdomain.com` (domain), or `http://actual:5006` (container name if on the same Docker network) |
| `ACTUAL_PASSWORD` | Actual Budget server password |
| `ACTUAL_BUDGET_SYNC_ID` | Budget Sync ID (Settings → Sync ID in Actual) |

All other variables are optional. See [Configuration Reference](../../README.md#complete-environment-variables-reference) in the README for the full table.

---

## Why the `/app/data` volume is required

Actual Budget does not expose a REST API. The `@actual-app/api` library (used internally) works by:

1. Connecting to your Actual Budget server
2. **Downloading a local copy of your budget data** into a `dataDir` folder
3. Running all queries and modifications on that local copy
4. Syncing changes back to the server

This is documented in the [official Actual API docs](https://actualbudget.org/docs/api/):

> *"The API client contains all the code necessary to query your data and will work on a local copy."*

The `/app/data` volume (the container's canonical data dir, `MCP_BRIDGE_DATA_DIR`) gives the container a persistent, writable place to store that local copy. **Without it the container has nowhere to write and will fail on startup.**

> Even if Actual Budget and actual-mcp run on the same machine, actual-mcp needs **its own separate `/app/data` folder**: it must not share the Actual Budget data directory.

This architecture also means actual-mcp and Actual Budget do **not** need to run on the same machine. You can have:
- Actual Budget running on Server A
- actual-mcp running on Server B (or a VPS, or a Raspberry Pi)
- You accessing it from Claude Desktop on your laptop

...as long as `ACTUAL_SERVER_URL` points to your Actual Budget instance over the network.

---

## Health Check & Connectivity Verification

The server exposes a health endpoint:

```bash
curl http://localhost:3600/health
# {"status":"ok","initialized":true,"version":"...","transport":"http"}
```

The Docker image includes a built-in `HEALTHCHECK` that polls this endpoint every 30 seconds.

**Full MCP handshake** (also verifies your token and server readiness):

```bash
curl -s -X POST http://localhost:3600/http \
  -H "Authorization: Bearer your_secret_token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli-test","version":"1.0"}}}' \
  | python3 -m json.tool
```

Replace `your_secret_token` with whatever you set in `MCP_SSE_AUTHORIZATION`.

- **Success**: JSON response containing `"protocolVersion"` and `"serverInfo"`
- **Wrong token**: `{"error": "Unauthorized"}`
- **Server not running**: `curl: (7) Failed to connect`

---

## Kubernetes

A Kubernetes deployment requires at minimum:

- A `Deployment` with the container image
- A `Secret` for `ACTUAL_PASSWORD` and `MCP_SSE_AUTHORIZATION`
- A `ConfigMap` for non-sensitive env vars
- A `Service` to expose the MCP server port
- An `Ingress` (or `IngressRoute`) for external access with TLS termination

**Example Secret:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: actual-mcp-secrets
type: Opaque
stringData:
  ACTUAL_PASSWORD: "your_password"
  MCP_SSE_AUTHORIZATION: "your_token"
  ACTUAL_BUDGET_SYNC_ID: "your-sync-id"
```

**Example Deployment:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: actual-mcp-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: actual-mcp-server
  template:
    metadata:
      labels:
        app: actual-mcp-server
    spec:
      containers:
        - name: actual-mcp-server
          image: ghcr.io/agigante80/actual-mcp-server:latest
          ports:
            - containerPort: 3600
          envFrom:
            - secretRef:
                name: actual-mcp-secrets
          env:
            - name: MCP_BRIDGE_PORT
              value: "3600"
            - name: ACTUAL_SERVER_URL
              value: "https://actual.yourdomain.com"
            - name: NODE_ENV
              value: "production"
            - name: MCP_BRIDGE_LOG_LEVEL
              value: "info"
          livenessProbe:
            httpGet:
              path: /health
              port: 3600
            initialDelaySeconds: 10
            periodSeconds: 30
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          volumeMounts:
            - name: data
              mountPath: /app/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: actual-mcp-data
```

> **Note:** The MCP server keeps a local SQLite copy of your budget data (downloaded by `@actual-app/api`) and needs persistent storage for it. Mount a `PersistentVolumeClaim` at `/app/data`, the container's canonical data dir (`MCP_BRIDGE_DATA_DIR`).

---

## Upgrading

```bash
# Docker
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker stop actual-mcp-server-backend
docker rm actual-mcp-server-backend
# Re-run with same flags as original docker run

# Docker Compose
docker compose pull
docker compose --profile production up -d
```

---

## Logs

```bash
# Docker
docker logs actual-mcp-server-backend --tail 100 -f

# Docker Compose
docker compose logs -f mcp-server-prod

# Enable file logging (add to .env)
MCP_BRIDGE_STORE_LOGS=true
MCP_BRIDGE_LOG_DIR=./logs
MCP_BRIDGE_LOG_LEVEL=info
```
