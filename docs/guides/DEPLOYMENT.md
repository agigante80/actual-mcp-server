# Deployment Guide

This guide covers all deployment methods for the Actual MCP Server.

---

## Prerequisites

- **Actual Budget server** running and accessible (local, Docker, or remote)
- Your **Budget Sync ID** from Actual: Settings → Show Advanced Settings → Sync ID
- **Node.js 20+** (for npm method) or **Docker** (for container methods)

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
# Edit .env — set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID at minimum

# Build TypeScript
npm run build

# Run server
npm run dev -- --http --debug
```

The server starts at `http://localhost:3000/http` by default.

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
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32) \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest

# Verify
curl http://localhost:3600/health
```

### Image Registries

```bash
# GitHub Container Registry (primary)
ghcr.io/agigante80/actual-mcp-server:latest
ghcr.io/agigante80/actual-mcp-server:0.4.26   # specific version

# Docker Hub (mirror)
agigante80/actual-mcp-server:latest
agigante80/actual-mcp-server:0.4.26
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
  -e ACTUAL_SERVER_URL=https://actual.yourdomain.com \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -e MCP_SSE_AUTHORIZATION=$TOKEN \
  -e MCP_BRIDGE_USE_TLS=true \
  -e MCP_BRIDGE_LOG_LEVEL=info \
  -e MCP_BRIDGE_STORE_LOGS=true \
  -e NODE_ENV=production \
  -v actual-mcp-data:/data \
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

| Profile | What it starts | Use case |
|---|---|---|
| `dev` | MCP server only, mounts `src/` for hot-reload | Local development |
| `production` | MCP server + Nginx proxy | Production, single host |
| `fullstack` | MCP server + Actual Budget server | All-in-one evaluation |

```bash
# Development (hot-reload source)
docker compose --profile dev up -d

# Production (Nginx proxy on port 3600, MCP on internal port 3000)
docker compose --profile production up -d

# Full stack (includes Actual Budget server on port 5006)
docker compose --profile fullstack up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**Default ports:**
- MCP server (HTTP): `3000` (dev) / `3600` (production via Nginx)
- Actual Budget server (fullstack): `5006`

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
| `ACTUAL_SERVER_URL` | URL of your Actual Budget server |
| `ACTUAL_PASSWORD` | Actual Budget server password |
| `ACTUAL_BUDGET_SYNC_ID` | Budget Sync ID (Settings → Sync ID in Actual) |

All other variables are optional — see [Configuration Reference](../../README.md#complete-environment-variables-reference) in the README for the full table.

---

## Health Check

The server exposes a health endpoint:

```bash
curl http://localhost:3600/health
# {"status":"ok","initialized":true,"version":"0.4.26","transport":"http"}
```

The Docker image includes a built-in `HEALTHCHECK` that polls this endpoint every 30 seconds.

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
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: actual-mcp-data
```

> **Note:** Actual Budget requires persistent storage for its SQLite files. Use a `PersistentVolumeClaim` mounted at `/data`.

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
