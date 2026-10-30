# Upgrading

How to move an existing install to a newer release, what each release requires, and the changes that can stop an upgraded server from starting.

## Requirements

This table names where each requirement is defined rather than copying a value that would go stale. Read the current value from the source.

| Requirement | Source of truth | How it is checked |
|-------------|-----------------|-------------------|
| Node.js floor | `engines.node` in `package.json` | `src/lib/node-version-guard.ts` refuses to run below it, because npm and npx do not enforce `engines`; `npm run node-version-drift` keeps the Dockerfile and workflows consistent with it |
| Actual Budget server range | `SUPPORTED_ACTUAL_SERVER_RANGE` (`minVersion`, `testedMaxMajor`) in `src/lib/constants.ts` | `src/lib/server-version-guard.ts` logs an advisory warning outside the range; it never fails startup or blocks an operation |
| Bundled `@actual-app/api` | `dependencies` in `package.json` | the `actual_server_info` tool reports the resolved version |
| This server's version | `version` in `package.json`, and the `vX.Y.Z` release tags | `npm run version:check` |

## Steps

### Docker

```bash
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker stop actual-mcp-server-backend
docker rm actual-mcp-server-backend
# Re-run the original docker run command with the same flags and volumes
```

Also available on Docker Hub: `docker pull agigante80/actual-mcp-server:latest`

### Docker Compose

```bash
docker compose pull
docker compose --profile production up -d
```

### npm or a cloned repo

```bash
git pull
npm install
npm run build
# Then restart the server
```

### npx and stdio

If you run `npx actual-mcp-server` without a globally installed version, npx fetches the latest from the registry automatically. But if you previously installed it globally (`npm install -g actual-mcp-server`), the global install takes precedence, so you must upgrade it explicitly:

```bash
# Upgrade the global install
npm install -g actual-mcp-server

# Or force the registry version without touching your global install
npx actual-mcp-server@latest --http
```

For Claude Desktop (stdio), restart Claude after upgrading.

## Changes that can stop an upgraded server

These notes are copied from [explanation/security-and-privacy.md](../explanation/security-and-privacy.md), which keeps the full context for each.

### HTTP auth is required by default (#242)

An existing HTTP deployment on a non-loopback bind with no token and no OIDC that previously started open will now refuse to start. The startup error names the fix: set `MCP_SSE_AUTHORIZATION` (generate with `openssl rand -hex 32`), or `AUTH_PROVIDER=oidc`, or `MCP_ALLOW_UNAUTHENTICATED=true` to keep the old open behavior. See [authentication.md](authentication.md) before choosing the last one.

### An invalid `AUTH_BUDGET_ACL` refuses startup (#551)

Before #551 an invalid value was logged once and then treated as "no ACL", so every authenticated user could reach every budget. A deployment whose value was silently invalid will refuse its first restart after upgrading, including one with `AUTH_PROVIDER=none` or `AUTH_BUDGET_ACL_SOURCE=actual`, where the variable was previously ignored. The fix is to correct the JSON or unset the variable.

### Old logs can hold budget data (v0.22.38)

Logs written by earlier versions can contain budget data (tool results at `info`, failed-call arguments at `error`). Purge them or let rotation remove them, including copies held by a log shipper or in Claude Desktop's MCP log files.

## Related

- [deployment.md](deployment.md): Docker and Compose profiles.
- [troubleshooting.md](troubleshooting.md): what to check when the upgraded server misbehaves.
