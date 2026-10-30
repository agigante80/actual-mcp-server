# Deployment Guide

This guide covers all deployment methods for the Actual MCP Server.

---

## Prerequisites

- **Actual Budget server** running and accessible (local, Docker, or remote)
- Your **Budget Sync ID** from Actual: Settings → Show Advanced Settings → Sync ID
- **Node.js 22+** (for npm method) or **Docker** (for container methods)

> **Your Actual server must have been bootstrapped with a PASSWORD.** This server
> authenticates through `@actual-app/api`, which supports password login only. If your
> Actual instance was set up with `ACTUAL_OPENID_*` from the very beginning and never
> had a password, it rejects password login and **this MCP server cannot connect to it
> at all**, for any tool. You will see `Authentication failed: Invalid redirect URL`,
> which does not hint at the real cause.
>
> Adding OpenID to a server that was already password-bootstrapped is fully supported
> and is the topology the multi-user features target: the password method remains
> accepted alongside OpenID. What is not recoverable is the OpenID-only case, because a
> password cannot be added afterwards (`POST /account/bootstrap` returns
> `already-bootstrapped`).
>
> This is an upstream capability gap, not a defect of this server: Actual deliberately
> refuses password login when OpenID is the active method, and offers no service-account
> path for headless API access.

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

The log level follows `NODE_ENV`: `debug` when it is unset (as here), `info` when it is `production`. `.env.example` leaves `MCP_BRIDGE_LOG_LEVEL` unset so a copied `.env` keeps that default; set `MCP_BRIDGE_LOG_LEVEL=debug` explicitly only when you need debug output under `NODE_ENV=production`. See [Upgrading](#upgrading) if your `.env` predates v0.22.39.

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

First create a private `.env` with a generated token. This is the same block as the README Docker quick start: it never overwrites a value you set, except a token that is missing, duplicated or shorter than 32 characters, and the last line prints the token your MCP client sends as its Bearer token:

```bash
[ -f .env ] || install -m 600 /dev/null .env
[ -z "$(tail -c 1 .env)" ] || printf '\n' >> .env
for key in ACTUAL_SERVER_URL=http://YOUR-ACTUAL-HOST:5006 ACTUAL_PASSWORD= ACTUAL_BUDGET_SYNC_ID=; do
  grep -q "^${key%%=*}=" .env || printf '%s\n' "$key" >> .env
done
chmod 600 .env
if [ "$(grep -c '^MCP_SSE_AUTHORIZATION=' .env)" != 1 ] || ! grep -Eq '^MCP_SSE_AUTHORIZATION=[^[:space:]]{32,}$' .env; then
  ( umask 077; install -m 600 /dev/null .env.new; { grep -v '^MCP_SSE_AUTHORIZATION=' .env; printf 'MCP_SSE_AUTHORIZATION=%s\n' "$(openssl rand -hex 32)"; } > .env.new ) && mv .env.new .env
fi
grep '^MCP_SSE_AUTHORIZATION=' .env
```

Then fill in `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_SYNC_ID` and `ACTUAL_SERVER_URL` in `.env`. The URL is read inside the container, where `localhost` is the container itself. Use the LAN address or domain of your Actual server (`http://192.168.1.50:5006`, `https://actual.yourdomain.com`), `http://host.docker.internal:5006` for Actual on the Docker host (the `--add-host` line below makes that name resolve on Linux), or `http://actual:5006` when both containers share a user-defined Docker network. Then start it:

<!-- runnable: quick-start-docker-run -->
```bash
docker run -d \
  --name actual-mcp-server-backend \
  -p 3600:3600 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -v actual-mcp-data:/app/data \
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest
```

Verify after a few seconds with `curl http://localhost:3600/health`.

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

Create `.env` with the Quick Start token block above and fill in the Actual settings (`ACTUAL_SERVER_URL=https://actual.yourdomain.com`, for example). Secrets stay in `.env`; only non-secret settings go on the command line. The port is bound to `127.0.0.1` for a reverse proxy on the same host:

<!-- runnable: production-docker-run -->
```bash
docker run -d \
  --name actual-mcp-server-backend \
  --restart unless-stopped \
  -p 127.0.0.1:3600:3600 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -e MCP_BRIDGE_USE_TLS=true \
  -e MCP_BRIDGE_LOG_LEVEL=info \
  -e MCP_BRIDGE_STORE_LOGS=true \
  -e NODE_ENV=production \
  -v actual-mcp-data:/app/data \
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest
```

Verify after a few seconds with `curl http://localhost:3600/health`.

### Unraid and PUID/PGID (#227)

The image starts as root, then an entrypoint aligns the runtime user to `PUID`/`PGID`,
fixes ownership of the writable volumes (`/app/data`, `/app/logs`), and drops privileges
to the non-root `app` user before starting the server. This lets the container write a
host appdata directory owned by a different UID without `EACCES`.

- On Unraid, set `PUID=99` and `PGID=100` (nobody:users) so it can write the appdata mounts.
- Off Unraid, omit `PUID`/`PGID`: they default to 1001 and the behavior is unchanged. If an
  orchestrator forces a non-root user (`--user`), the entrypoint is a no-op and `PUID`/`PGID`
  are ignored.

actual-mcp-server is published to the Unraid Community Applications catalog via
`unraid/actual-mcp-server.xml`; see [docs/UNRAID_CA_PUBLISHING.md](../UNRAID_CA_PUBLISHING.md).
Set a strong `MCP_SSE_AUTHORIZATION` token (`openssl rand -hex 32`) before exposing the port.
Without a bearer token, per-client tokens (`MCP_STATIC_TOKENS`) or OIDC the server refuses to
start on a non-loopback bind, unless `MCP_ALLOW_UNAUTHENTICATED=true` is set deliberately (then
every tool, writes included, is served to anyone who can reach the port). A reverse proxy that
does not authenticate does not replace the token. `/health`, `/metrics`, `/mcp-info` and
`/mcp-info/http` are unauthenticated by design; with `AUTH_PROVIDER=oidc` the `/.well-known/`
OAuth metadata documents are public too.

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
# Development (hot-reload source, unauthenticated, bound to 127.0.0.1 only)
docker compose --profile dev up -d

# Production
docker compose --profile production up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**Default ports:**
- MCP server (HTTP): `3600`. Both the `dev` and `production` compose profiles set `MCP_BRIDGE_PORT=3600`. `production` publishes `3600:3600`; `dev` runs without authentication and publishes `127.0.0.1:3600:3600` only. To reach a dev server from another machine, override `ports` in a `docker-compose.override.yml` (and set a token first).
- A standalone `docker run` of the image listens on whatever `MCP_BRIDGE_PORT` you set (the application default is `3600`). The image's `EXPOSE` and `HEALTHCHECK` also use `3600`, so a direct `docker run` is consistent out of the box: map `-p 3600:3600` and the healthcheck and your published port agree.

> **Upgrading from an earlier version?** The Compose profiles previously published the MCP server on host port `3000`; they now use `3600` to match the published image and all guides. If you reach the server on `3000` today, update your host mapping, reverse proxy, or client URL to `3600`. Your budget data is unaffected: the named volume and the host data directory are unchanged, only the in-container mount path moved from `/data` to `/app/data` together with `MCP_BRIDGE_DATA_DIR`, so the same files are still read.

### Production Compose deployment

```bash
# 1. Clone and configure (never overwrites an existing .env)
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server
[ -f .env ] || install -m 600 .env.example .env
# Set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID; add the token with the
# Quick Start token block above (the README Option B block does both steps)

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

> **One process per data dir.** Never run a second actual-mcp process, for example `docker exec <container> node dist/src/index.js --stdio`, on a running server's `MCP_BRIDGE_DATA_DIR`, and never point two containers at one data folder. Each process keeps its own local copy of the budget and syncs it; a second writer leaves the other with a stale copy, and its next sync breaks every later session open with `out_of_sync` until that budget's local copy is moved out of the data dir. Give the second process its own dir with `-e MCP_BRIDGE_DATA_DIR=<another path>` (and `-u app` with `docker exec`, so it does not leave root-owned files behind). Pick a path the `app` user can write: a subdirectory of the data volume such as `/app/data/stdio` is persistent and isolated, while `/app` itself is root-owned, so a path like `/app/stdio-data` fails at startup. See #575.

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
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"cli-test","version":"1.0"}}}' \
  | python3 -m json.tool
```

Replace `your_secret_token` with whatever you set in `MCP_SSE_AUTHORIZATION`.

- **Success**: JSON response containing `"protocolVersion"` and `"serverInfo"`
- **Wrong token**: `{"error": "Unauthorized"}`
- **Server not running**: `curl: (7) Failed to connect`

---


## Release rollback runbook (#324)

**Deliberately NOT automated.** A system that both publishes and unpublishes can thrash, and a revert loop is a worse failure than a bad release sitting still. This is a human procedure.

### If a bad `@actual-app/api` version shipped

**Do the denylist entry FIRST, before reverting.** This ordering is the whole point:

1. **Add the version to `.github/actual-api-denylist.txt` ON `main`.**

   ```
   26.8.0  # broke stdio framing, see #NNN, 2026-08-04
   ```

   The train checks out `ref: main` and never reads `develop`, so **only the copy on `main` has any effect.** A denylist entry sitting on `develop` protects nothing.

2. **Then revert the dependency**, pinning EXACTLY, with no caret or tilde. A caret defeats a pin: `^26.7.0` resolves to 26.8.0 while 26.8.0 is published.

3. Confirm the next nightly run reports `noop_denied` in its step summary.

**Why this order.** Reverting without a denylist entry lasts exactly one run. `CURRENT` becomes the old version, `LATEST` is still the bad one upstream, and that is a strict forward move, so the direction check is satisfied and the train re-upgrades the same night. The failure signature is the expensive part: "I fixed it, it worked, it came back on its own" sends the next person to re-audit a fix that was correct all along.

### Consequence to expect while denied or soaking

`classifyOutcome` maps every `noop_*` to `ignore`, and `decideTransition` closes an open issue only on `success`. So once the train enters a persistent denied state, it **cannot auto-close an already-open `train-failure` issue.** That issue will sit with a frozen counter until someone closes it by hand. This is accepted, not a bug; closing it manually is safe, because a manually closed issue is never reopened and the next genuine failure files a fresh one.

### Reverting our own bad release

**npm publishes cannot be undone, and that is accepted rather than engineered around (#326).**

The obvious mitigation is a staged publish: ship to a `next` dist-tag, verify, then promote `latest`. It is rejected, and the reason is worth recording so nobody re-derives it:

- `npm dist-tag add` is **not supported by npm Trusted Publishers** (npm/cli#8547). This repo publishes with `npm publish --provenance --access public` over OIDC and holds **no** `NPM_TOKEN` at all.
- Implementing the promotion would therefore mean reintroducing a long-lived npm credential into a pipeline that runs unattended every night. That trades a small, rare risk (a bad auto-published version) for a large, permanent one (a standing publish credential).
- Staging would **not** make a publish reversible anyway. The version is immutable and public the instant it lands, `next` or not. It only keeps `latest` clean.

**Revisit if npm/cli#8547 ships.** If `dist-tag` becomes OIDC-authenticated, staged publishing becomes genuinely cheap and this decision should be reopened.

#### The actual remedy: deprecate and out-version

```bash
# 1. Mark the bad version, with a reason users will see on install.
npm deprecate actual-mcp-server@0.9.4 \
  "Broken stdio framing; use 0.9.5 or later. See https://github.com/agigante80/actual-mcp-server/issues/NNN"

# 2. Confirm it took.
npm view actual-mcp-server@0.9.4 deprecated

# 3. Ship the fix as a NEW version. Never try to reuse the bad one.
#    (Within 72 hours `npm unpublish actual-mcp-server@0.9.4` is possible, but it
#    breaks anyone who already installed it and is not the preferred path.)
```

Docker is more forgiving: retag and move `latest`, no deprecation needed.

#### Verification runs automatically

`verify-published-artifacts` in `ci-cd.yml` reads back npm, Docker Hub and ghcr.io after every tagged release, and the `release` job needs it, so a half-shipped release is not announced. It distinguishes three states: `confirmed_present`, `confirmed_absent` (a definite negative after the full retry budget) and `inconclusive` (we could not ask). Only the second is a genuine missing-artifact incident; both are red, but they are named differently because a network blip and a missing package are different problems.

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

**From v0.22.39:** `.env.example` no longer pins `MCP_BRIDGE_LOG_LEVEL=debug`. A `.env` copied from an older example still does, which keeps a `NODE_ENV=production` run (for example `docker run --env-file .env`) at debug level. Remove that line so the production default (`info`) applies.

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
