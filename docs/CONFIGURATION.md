# Configuration Reference (canonical matrix)

This is the single authoritative inventory of every configuration variable the
Actual MCP Server understands. It is kept in sync with the code by the drift guard
`scripts/config-drift.mjs` (run in CI via `tests/unit/config_drift.test.js`), which
fails the build when a variable is in the schema or allowlist but missing from
`.env.example` or the README env table, or vice versa.

**Single source of truth.** A variable is canonical if it is EITHER a Zod schema key
in `src/config.ts` OR an entry in `RAW_ENV_ALLOWLIST` in `src/lib/config-registry.ts`.
Schema vars are validated and defaulted at startup. Allowlist vars are read directly
from `process.env`, with a documented reason (mostly: read before `config.ts` loads,
or read in the deferred-config entry `src/index.ts`). The registry is the in-code
record; this file is the human reference.

Legend for **Source**: `schema` = validated Zod key; `raw` = read directly from
`process.env` (allowlist); `dynamic` = enumerated family (not declared one by one);
`os` = read by the OS/runtime, not the app.

## Actual Budget connection

| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |
|----------|------|---------|----------|--------|--------|--------------|-------|
| `ACTUAL_SERVER_URL` | url string | (none) | Yes | no | schema | config | Actual Budget server URL |
| `ACTUAL_PASSWORD` | string | (none) | Yes | yes | schema | config | Actual Budget server password (Zod default is the empty string) |
| `ACTUAL_BUDGET_SYNC_ID` | string | (none) | Yes | no | schema | config | Default budget sync ID |
| `ACTUAL_BUDGET_PASSWORD` | string | (none) | No | yes | schema | config; also raw at `actualConnection.ts:33`, `ActualConnectionPool.ts:255,338` | E2E encryption password |
| `ALLOW_INSECURE_UPSTREAM` | bool string | `false` | No | no | schema | config | Allow `http://` upstream with an encryption password set (#161) |
| `ACTUAL_OP_TIMEOUT_MS` | int string (ms) | `30000` | No | no | schema | config; read at `actual-adapter.ts` `withOpTimeout` | Per-operation timeout bounding every upstream call (init, download, sync, op body) so a stall cannot hold the global API mutex forever (#270). `0` disables |

## MCP server

| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |
|----------|------|---------|----------|--------|--------|--------------|-------|
| `MCP_BRIDGE_PORT` | port string | `3600` | No | no | schema | config; also raw at `index.ts:194` (the listen path) | Canonical port (#230) |
| `MCP_BRIDGE_BIND_HOST` | string | `0.0.0.0` | No | no | raw | `index.ts` | Bind interface |
| `MCP_BRIDGE_DATA_DIR` | path string | `./actual-data` (image: `/app/data`) | No | no | schema | config | Local budget cache dir (#228) |
| `MCP_BRIDGE_PUBLIC_HOST` | string | auto-detected | No | no | raw | `index.ts:269`, `httpServer.ts:581` | Advertised public host |
| `MCP_BRIDGE_PUBLIC_SCHEME` | string | auto-detected | No | no | raw | `index.ts` | Advertised scheme override |
| `MCP_BRIDGE_USE_TLS` | bool string | `false` | No | no | raw | `index.ts:277` | Deprecated alias of `MCP_ENABLE_HTTPS`; affects ONLY the advertised scheme |
| `MCP_HTTP_BODY_LIMIT` | size string | `512kb` | No | no | schema | config | Max JSON-RPC request body (#168) |
| `MCP_TRANSPORT_MODE` | enum | `--http` | No | no | schema | config | `--http` (stdio uses the `--stdio` flag) |

## Transport / routing

| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |
|----------|------|---------|----------|--------|--------|--------------|-------|
| `MCP_HTTP_PATH` | path | `/http` | No | no | raw | `index.ts:195` | The path the server LISTENS on |
| `MCP_BRIDGE_HTTP_PATH` | path | same as `MCP_HTTP_PATH` | No | no | raw | `index.ts:281` | The path ADVERTISED to clients (falls back to `MCP_HTTP_PATH`) |

## Sessions / pool

| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |
|----------|------|---------|----------|--------|--------|--------------|-------|
| `USE_CONNECTION_POOL` | bool string | `true` | No | no | raw | `actualConnection.ts` | Enable session pooling (future schema-promotion candidate) |
| `MAX_CONCURRENT_SESSIONS` | int string | `15` | No | no | schema | config; also raw at `ActualConnectionPool.ts:60` | Max concurrent MCP sessions |
| `SESSION_IDLE_TIMEOUT_MINUTES` | int string | `5` | No | no | raw | `ActualConnectionPool.ts:63` | Minutes before idle session cleanup (future schema-promotion candidate) |
| `ACTUAL_API_CONCURRENCY` | int string | `5` | No | no | raw | `lib/actual-adapter/concurrency.ts` | Adapter concurrency cap (future schema-promotion candidate) |

## Security / authentication

| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |
|----------|------|---------|----------|--------|--------|--------------|-------|
| `AUTH_PROVIDER` | enum | `none` | No | no | schema | config | `none` (static Bearer) or `oidc` |
| `MCP_SSE_AUTHORIZATION` | string | (none) | No | yes | schema | config | Static Bearer token (raw token, not `Bearer ...`) |
| `MCP_ALLOW_UNAUTHENTICATED` | bool string | `false` | No | no | schema | `index.ts` | #242 opt-out: only `true` lets HTTP serve unauthenticated on a non-loopback bind; otherwise the server refuses to start |
| `OIDC_ISSUER` | url string | (none) | If oidc | no | schema | config | OIDC issuer URL |
| `OIDC_ALLOW_INSECURE_ISSUER` | bool string | `false` | No | no | schema | `httpServer.ts` | #244 opt-out: allow an http OIDC issuer on a trusted network (default refuses non-https/non-loopback issuers at startup) |
| `OIDC_RESOURCE` | url string | (none) | No | no | schema | config | Expected `aud` claim |
| `OIDC_ACCEPTED_AUDIENCES` | csv string | (none) | No | no | schema | `httpServer.ts` | #245 extra accepted `aud` values beyond `OIDC_RESOURCE` (strict allowlist; for IdPs that put the client-id in `aud`, e.g. Authentik) |
| `OIDC_JWKS_TRUSTED_HOSTS` | csv string | (none) | No | no | schema | `httpServer.ts` | #254 opt-in cross-origin JWKS hosts (`host` or `host:port`, exact match, no wildcards). For IdPs whose `jwks_uri` lives on another host, e.g. Google: `OIDC_ISSUER=https://accounts.google.com` needs `OIDC_JWKS_TRUSTED_HOSTS=www.googleapis.com`. Empty default keeps same-origin-only |
| `OIDC_SCOPES` | csv string | (none) | No | no | schema | config | Comma-separated required scopes |
| `AUTH_BUDGET_ACL` | json string | (none) | No | no | schema | config | Per-user budget ACL map |
| `MCP_ENABLE_HTTPS` | bool string | `false` | No | no | schema | config; also raw at `index.ts:277,286` | Native TLS switch (canonical TLS knob) |
| `MCP_HTTPS_CERT` | path | (none) | No | no | schema | config; also raw at `index.ts:287` | PEM cert path (required when TLS on) |
| `MCP_HTTPS_KEY` | path | (none) | No | yes | schema | config; also raw at `index.ts:288` | PEM key path (required when TLS on) |

## Logging

| Variable | Type | Default | Required | Secret | Source | Read site(s) | Notes |
|----------|------|---------|----------|--------|--------|--------------|-------|
| `MCP_BRIDGE_STORE_LOGS` | bool string | `false` | No | no | raw | `logger.ts:14` | Enable file logging |
| `MCP_BRIDGE_LOG_DIR` | path | `app/logs` (beside the install) | No | no | raw | `logger.ts:15` | Log file directory. When unset the code falls back to `app/logs` next to the module; `.env.example` and Docker set it explicitly (`./logs`, `/app/logs`) |
| `MCP_BRIDGE_LOG_LEVEL` | enum | `debug` (dev) / `info` (prod) | No | no | raw | `logger.ts:77` | Winston log level |
| `LOG_LEVEL` | enum | (none) | No | no | raw | `utils.ts` | Debug-detection toggle, DISTINCT from `MCP_BRIDGE_LOG_LEVEL` |
| `LOG_FORMAT` | enum | auto (`json` if prod, else `pretty`) | No | no | raw | `logger.ts:74` | Output format |
| `MCP_SERVICE_NAME` | string | `actual-mcp-server` | No | no | raw | `logger.ts:78` | Service name on json log records |
| `MCP_BRIDGE_MAX_FILES` | string | `14d` | No | no | raw | `logger.ts:23` | Log retention |
| `MCP_BRIDGE_MAX_LOG_SIZE` | string | `20m` | No | no | raw | `logger.ts:22` | Rotate-at size |
| `MCP_BRIDGE_ROTATE_DATEPATTERN` | string | `YYYY-MM-DD` | No | no | raw | `logger.ts:21` | Rotated filename pattern |
| `MCP_BRIDGE_DEBUG_TRANSPORT` | bool string | `false` | No | no | raw | `index.ts`, `utils.ts` | Transport debug output |

## Multi-budget (dynamic family)

`BUDGET_n_*` variables (n = 1, 2, 3, ...) are enumerated at runtime by
`src/lib/budget-registry.ts`, not declared individually. `.env.example` documents
example members; the README env table uses the `BUDGET_N_*` notation.

| Variable | Type | Default | Required | Secret | Source | Notes |
|----------|------|---------|----------|--------|--------|-------|
| `BUDGET_DEFAULT_NAME` | string | `Default` | No | no | dynamic | Friendly name for the default budget |
| `BUDGET_n_NAME` | string | (none) | No | no | dynamic | Name of budget n |
| `BUDGET_n_SYNC_ID` | string | (none) | No | no | dynamic | Sync ID of budget n |
| `BUDGET_n_SERVER_URL` | url string | falls back to `ACTUAL_SERVER_URL` | No | no | dynamic | Server URL for budget n |
| `BUDGET_n_PASSWORD` | string | falls back to `ACTUAL_PASSWORD` | No | yes | dynamic | Password for budget n |
| `BUDGET_n_ENCRYPTION_PASSWORD` | string | (none) | No | yes | dynamic | E2E password for budget n |

## OS / runtime and internal

| Variable | Default | Source | Notes |
|----------|---------|--------|-------|
| `TZ` | `UTC` (host) | os | Container timezone, read by the OS/runtime, not the app. The app sets no default; container images commonly default to UTC |
| `NODE_ENV` | (none) / `production` | raw (internal) | Selects prod log format and behaviours |
| `DEBUG` | (none) | raw (internal) | Framework debug toggle |
| `MCP_STDIO_MODE` | `false` | raw (internal, not documented) | Mirrors the `--stdio` CLI flag; set in-process before the logger import |
| `DOTENV_CONFIG_QUIET` | (none) | raw (internal, not documented) | dotenv flag |
| `VERSION` | build arg | raw (internal, not documented) | Injected by the Docker build |

## Maintaining this file

- Adding a schema var: add it to `src/config.ts`, document it in `.env.example` and the
  README env table, add a row here, then run `node scripts/config-drift.mjs --check`.
- Adding a var read directly from `process.env`: add it to `RAW_ENV_ALLOWLIST` in
  `src/lib/config-registry.ts` (with a reason and read site), then document it the same
  way (set `documented: false` only for true internals like a build arg).
- The drift guard treats both uncommented and commented `KEY=` lines in `.env.example`
  as documented, collapses the `BUDGET_*` family, and exempts OS-level vars (`TZ`).
