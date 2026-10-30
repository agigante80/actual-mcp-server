# Troubleshooting

Symptoms that come up most often, with their cause and fix. Client-specific checks, including where each client writes its logs, stay in the troubleshooting sections of [MCP_CLIENTS_SETUP.md](MCP_CLIENTS_SETUP.md) and [AI_CLIENT_SETUP.md](AI_CLIENT_SETUP.md).

## `URL must use HTTPS`

`mcp-remote` enforces HTTPS by default. Add `--allow-http` to its arguments for a plain HTTP server. Some versions of Claude Desktop enforce HTTPS at the app level instead (`URL must start with 'https'`); there, serve TLS with `MCP_ENABLE_HTTPS=true` or a reverse proxy (see [deployment.md](deployment.md)).

## HTTP 401 `Unauthorized: Invalid token`

The token the client sends does not match the server's (`src/server/httpServer.ts`). The usual causes:

- `MCP_SSE_AUTHORIZATION` holds `Bearer <token>` instead of the raw token. Set it to the token only; the client sends the `Bearer ` prefix in its header.
- The client and the server hold different values, often after a rotation. The server reads configuration once at startup, so restart it after changing the token.

Since #447 the SSE stream (a GET on the MCP path) is checked too, so a client that used to connect there without a token now gets 401.

## The server exits at startup on HTTP

It is exposed with no authentication configured and refuses to run open (#242). Configure a token or OIDC, bind to loopback, or opt out deliberately; [authentication.md](authentication.md) explains each option. A message naming `AUTH_BUDGET_ACL` means its JSON is invalid (#551); fix it or unset it.

## A call stalls for 30 seconds, then `Actual API operation timed out`

Every upstream call is bounded by `ACTUAL_OP_TIMEOUT_MS` (default 30000, `src/lib/opTimeout.ts`) so a stall cannot hold the API lock forever. A timeout means the Actual server did not answer in time: check that it is reachable from the MCP server and not overloaded. If the Actual server is reachable but slow, raise `ACTUAL_OP_TIMEOUT_MS` (see [reference/configuration.md](../reference/configuration.md)); a client may also need its own request timeout raised.

If you are changing a tool and every call to it stalls this way, the tool most likely nests one adapter session inside another; the API lock is not reentrant (see [AGENTS.md](../../AGENTS.md)).

## `Too many requests` from Actual

The Actual server rate-limits logins. The adapter retries a throttled login with backoff (`src/lib/actual-adapter/auth-retry.ts`) and reuses one connection per MCP session so ordinary use does not log in per call, but a burst of new sessions, or many processes sharing one Actual account, can still hit the limit. A session that fails this way reports `rate_limited` rather than `auth_failed` (#452). Wait for the limit to reset, then reduce how many sessions or processes log in at once.

## Connection refused

Nothing is listening where the client points. Check that the server is running (`docker ps` and `docker logs actual-mcp-server-backend` for the container), that the port matches `MCP_BRIDGE_PORT`, and that the health check answers with `curl` from the machine or container the client runs in. For the Actual side, check that `ACTUAL_SERVER_URL` is reachable; from a clone, `npm run dev -- --test-actual-connection` tests that connection alone.

## The client connects but shows no tools

The client must use the Streamable HTTP transport (`streamable-http` in LibreChat). See the client guide's troubleshooting table.

## Related

- [authentication.md](authentication.md)
- [multiple-budgets.md](multiple-budgets.md)
- [upgrading.md](upgrading.md)
