# Troubleshooting

Symptoms that come up most often, with their cause and fix. Client-specific checks, including where each client writes its logs, stay in the troubleshooting section of each client page under [clients/](clients/README.md).

## `URL must use HTTPS`

`mcp-remote` enforces HTTPS by default. Add `--allow-http` to its arguments for a plain HTTP server. Some versions of Claude Desktop enforce HTTPS at the app level instead (`URL must start with 'https'`); there, serve TLS with `MCP_ENABLE_HTTPS=true` or a reverse proxy (see [deployment.md](deployment.md)).

## HTTP 401 `Unauthorized: Invalid token`

The token the client sends does not match the server's (`src/server/httpServer.ts`). The usual causes:

- `MCP_SSE_AUTHORIZATION` holds `Bearer <token>` instead of the raw token. Set it to the token only; the client sends the `Bearer ` prefix in its header.
- The client and the server hold different values, often after a rotation. With `MCP_STATIC_TOKENS`, the client's token must equal the `MCP_TOKEN_*` variable its entry names. The server reads configuration once at startup, so restart it after changing a token.

Since #447 the SSE stream (a GET on the MCP path) is checked too, so a client that used to connect there without a token now gets 401.

## The server exits at startup on HTTP

It is exposed with no authentication configured and refuses to run open (#242). Configure a token or OIDC, bind to loopback, or opt out deliberately; [authentication.md](authentication.md) explains each option. A message naming `AUTH_BUDGET_ACL` means its JSON is invalid (#551); fix it or unset it.

## A call stalls for 30 seconds, then `Actual API operation timed out`

Every upstream call is bounded by `ACTUAL_OP_TIMEOUT_MS` (default 30000, `src/lib/opTimeout.ts`) so a stall cannot hold the API lock forever. A timeout means the Actual server did not answer in time: check that it is reachable from the MCP server and not overloaded. If the Actual server is reachable but slow, raise `ACTUAL_OP_TIMEOUT_MS` (see [reference/configuration.md](../reference/configuration.md)); a client may also need its own request timeout raised (for example `timeout` in a [LibreChat](clients/librechat.md) entry).

If you are changing a tool and every call to it stalls this way, the tool most likely nests one adapter session inside another; the API lock is not reentrant (see [AGENTS.md](../../AGENTS.md)).

## `Too many requests` from Actual

The Actual server rate-limits logins. The adapter retries a throttled login with backoff (`src/lib/actual-adapter/auth-retry.ts`) and reuses one connection per MCP session so ordinary use does not log in per call, but a burst of new sessions, or many processes sharing one Actual account, can still hit the limit. A session that fails this way reports `rate_limited` rather than `auth_failed` (#452). Wait for the limit to reset, then reduce how many sessions or processes log in at once.

## Connection refused

Nothing is listening where the client points. Check that the server is running (`docker ps` and `docker logs actual-mcp-server-backend` for the container), that the port matches `MCP_BRIDGE_PORT`, and that the health check answers with `curl` from the machine or container the client runs in. For the Actual side, check that `ACTUAL_SERVER_URL` is reachable; from a clone, `npm run dev -- --test-actual-connection` tests that connection alone.

## The client connects but shows no tools

The client must use the Streamable HTTP transport (`streamable-http` in [LibreChat](clients/librechat.md), not `sse`). After editing a client's config file, fully restart the client. See the troubleshooting table on the [client's page](clients/README.md).

## Session not found after a restart

The HTTP transport is stateful: each client connection gets an `mcp-session-id`, and the live session lives in the server process memory. When the container is recreated (an env change, an image update, a host reboot), those in-memory sessions are gone. A client that reuses its cached `mcp-session-id` then receives the MCP spec signal:

```
HTTP 404  {"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found. Please re-initialize ..."}}
```

**A client that ends its session frees its slot at once (#563).** Clients that send HTTP `DELETE` with their `mcp-session-id` when they disconnect (the MCP spec's way to end a session; Gemini is one) release the session immediately, including its connection-pool slot and any budget it selected. Clients that just stop calling are reaped by the idle sweep after `SESSION_IDLE_TIMEOUT_MINUTES`, so on a busy server a client that never sends `DELETE` holds a slot until then.

**A session that was never usable reports why (#438).** The 404 above means the session is simply gone. A different case looks identical to a client but is not: the session was created, its connection to Actual failed to initialise, and the transport was never registered. Since #438 that answer names the cause instead of the generic sentence:

```
HTTP 404  {"jsonrpc":"2.0","error":{
  "code": -32001,
  "message": "The Actual server's database schema is newer than the @actual-app/api this build bundles. ... Please re-initialize by calling initialize without an mcp-session-id header once the cause is fixed.",
  "data": { "cause": "schema_too_new", "sessionInitFailed": true }
}}
```

`data.cause` is a CLOSED enum, safe to branch on: `schema_too_new`, `auth_failed`, `network_unreachable`, `budget_not_found`, `out_of_sync`, `encryption_error`, `clock_drift`, `permission_denied`, `timeout`, `rate_limited`, `unknown`. (`rate_limited` was added in #452: a throttled login used to report `auth_failed`, which told a rate-limited user to check their password.) `data.sessionInitFailed` distinguishes this case from an ordinary expired session. The message carries no upstream error text by design, so it never leaks server paths, SQL or URLs; the full error is in the server log. The record lives 60 seconds, after which the generic body returns.

The client action is the same in both cases (re-initialize), but `sessionInitFailed: true` means a bare retry will fail again until the underlying cause is fixed, so a client should surface the message rather than silently looping.

What a spec-compliant client should do on that 404 is send a fresh `initialize` (without an `mcp-session-id` header), cache the new id, and retry. The server cannot resurrect the old session id: the MCP SDK assigns a session id only during `initialize` and validates later requests by exact match, with no way to re-adopt a previously issued id.

To make that recovery cheap (a quiet re-initialize, not a full sign-in), keep the OAuth token decoupled from the MCP session:

- **Token lifetime and refresh:** configure your OIDC provider (e.g. Logto) so access tokens outlive a typical restart and the client holds a refresh token. With a valid cached/refreshed token, the post-404 `initialize` does not trigger a new consent screen. The server validates whatever token arrives on every request, so it never forces a re-consent on its own.
- **Avoid needless recreates:** most settings do not require recreating the container; prefer a reload where possible.
- **Known client limitation:** some clients (including the Claude app and Claude Code, per upstream reports) do not yet auto re-initialize on a 404 and require a manual reconnect of the connector. That is a client-side gap, not a server one; the server already returns the correct signal.

**Active budget after recovery:** the server remembers each authenticated principal's last selected budget (keyed by a SHA-256 hash of the principal, never the raw identity) and restores it on the new session, after re-checking the live access list. So a user who switched budgets keeps that budget across a restart, provided their ACL still permits it.

## A client config file is ignored

A missing comma or bracket in a JSON config makes most clients skip the server without saying so. Validate the file locally:

```bash
python3 -m json.tool /path/to/your/config.json
```

Do not paste a config into an online validator unless it holds only references (`${...}`), never a literal password or token.

## `Actual Budget not found` or sync errors

- Check that `ACTUAL_SERVER_URL` is reachable from where the server runs: `curl http://localhost:5006`.
- Check that the Sync ID matches exactly (in Actual: Settings, Show advanced settings, Sync ID).
- Check that the Actual Budget server is running.

## Related

- [authentication.md](authentication.md)
- [multiple-budgets.md](multiple-budgets.md)
- [upgrading.md](upgrading.md)
