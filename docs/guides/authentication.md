# Authentication

How a client proves who it is to this server, and which budgets each mode lets it reach. This guide is the task view; the full model, threat analysis and history live in [explanation/security-and-privacy.md](../explanation/security-and-privacy.md). Every variable named here is listed in [reference/configuration.md](../reference/configuration.md).

## Pick a mode

| Mode | Transport | Configure | Who the caller is | Budgets it can reach |
|------|-----------|-----------|-------------------|----------------------|
| stdio | stdio | nothing (the client launches the process) | the local user | every configured budget |
| Shared token | HTTP | `MCP_SSE_AUTHORIZATION` | one principal, `static-bearer`, for every client | every configured budget |
| One token per client | HTTP | `MCP_STATIC_TOKENS` plus one `MCP_TOKEN_*` per client | the JSON key of the matching entry | only the budgets in that entry's `budgets` list |
| OIDC | HTTP | `AUTH_PROVIDER=oidc` plus `OIDC_ISSUER` and the other `OIDC_*` settings | the verified JWT subject | every budget when `AUTH_BUDGET_ACL` is unset, empty or `{}`; otherwise only what the ACL grants |
| Opt-out | HTTP | `MCP_ALLOW_UNAUTHENTICATED=true` | one anonymous principal | every configured budget |

stdio has no authentication: whoever can start the process already holds the `.env` credentials. The rest of this guide is about HTTP.

## Shared token: `MCP_SSE_AUTHORIZATION`

Generate a token and set it on the server:

```bash
openssl rand -hex 32
```

```bash
MCP_SSE_AUTHORIZATION=<your-generated-token>
```

Clients send `Authorization: Bearer <your-generated-token>`. Set the variable to the raw token only: a value that starts with `Bearer ` never matches, and every request gets HTTP 401 `Unauthorized: Invalid token` (`src/server/httpServer.ts`).

Every client is the same principal, `static-bearer`, so all clients share one budget preference and can reach every budget. Rotating the token means changing the value and restarting: configuration is read once at startup.

## One token per client: `MCP_STATIC_TOKENS`

Give each client its own token, principal and budget allow-list, without running an identity provider (#572):

```bash
MCP_STATIC_TOKENS={"alice":{"tokenEnv":"MCP_TOKEN_ALICE","budgets":["Home"]},"bob":{"tokenEnv":"MCP_TOKEN_BOB","budgets":["Home","Business"]}}
MCP_TOKEN_ALICE=<openssl rand -hex 32>
MCP_TOKEN_BOB=<openssl rand -hex 32>
```

What `src/auth/static-tokens.ts` checks before the server binds (any violation refuses startup, and the message names the variable but never prints a token):

- `budgets` is a non-empty array of registry names (`BUDGET_DEFAULT_NAME`, `BUDGET_n_NAME`), resolved to sync ids at startup. An unknown name refuses startup. `"*"` is not accepted: a static principal is always restricted.
- `tokenEnv` starts with `MCP_TOKEN_`, so it cannot point at `ACTUAL_PASSWORD`.
- The token it names is set, at least 32 characters, uses only RFC 6750 token characters, and is unique across all principals and `MCP_SSE_AUTHORIZATION`.
- The principal name `static-bearer` is reserved for the shared token.
- `MCP_STATIC_TOKENS` is refused together with `AUTH_PROVIDER=oidc`, where the verified JWT decides the principal.

A budget outside the list is refused on every operation, a switch to one returns the same "not found" as a name that does not exist, and the budget listings show only the permitted budgets. `MCP_SSE_AUTHORIZATION` may stay set beside it while clients move over one at a time; the startup log flags it as unrestricted. Limitations (no in-process rate limiter, a shared session pool, one open budget per process) are listed under "One static token per client" in [security-and-privacy.md](../explanation/security-and-privacy.md).

## OIDC

Set `AUTH_PROVIDER=oidc` and the issuer settings. The client walkthrough, including Casdoor and LibreChat, is in [AI_CLIENT_SETUP.md](AI_CLIENT_SETUP.md); the model is under "OIDC / JWT Authentication" in [security-and-privacy.md](../explanation/security-and-privacy.md).

Budget scope comes from `AUTH_BUDGET_ACL` (`src/auth/budget-acl.ts`):

- **Unset, an empty string, or `{}` is open**: every authenticated user may reach every budget. This is fail-open by design, so configure the ACL before you rely on it to cut anyone off.
- **A non-empty JSON object restricts.** It maps a principal (the JWT `sub`, the `email` claim, or `group:<name>` for an entry of the `groups` or `roles` claim) to an array of budget sync ids; `"*"` grants every budget. A user who matches nothing gets HTTP 403.
- **An invalid value refuses startup** (#551), on HTTP and stdio alike, whatever `AUTH_PROVIDER` is set to.
- **`AUTH_BUDGET_ACL_SOURCE=actual`** (default `static`) reads each budget's access list from the Actual server instead of the variable.

## Running without authentication

On HTTP the server refuses to start when it would be exposed with nothing configured (#242). The decision is `evaluateHttpAuthPosture` in `src/lib/authPosture.ts`, made once at startup against the configured bind host, in this order:

1. A token (`MCP_SSE_AUTHORIZATION` or `MCP_STATIC_TOKENS`) or `AUTH_PROVIDER=oidc` is configured: the server starts.
2. The bind host `MCP_BRIDGE_BIND_HOST` is loopback (`localhost`, any address in `127.0.0.0/8`, `::1` in either spelling, or `::ffff:127.x.x.x`): the server starts, with or without the opt-out. The default `0.0.0.0` is not loopback.
3. `MCP_ALLOW_UNAUTHENTICATED=true`: the server starts open and logs a loud warning on every boot. Only the exact string `true` enables it (`src/config.ts`).
4. Otherwise it logs an error naming the fixes and exits with status 1.

So the opt-out changes nothing on a loopback bind, and on any other bind it turns the refusal into an open server that every caller reaches as the same anonymous principal, with every budget. Use it only behind your own reverse proxy that authenticates every request. A proxy that only forwards, or a network you consider trusted, is not a substitute: anyone who can reach the port can read and write every budget.

## Related

- [multiple-budgets.md](multiple-budgets.md): the budget names that `budgets` and the ACL refer to.
- [troubleshooting.md](troubleshooting.md): 401s, HTTPS errors and timeouts.
- [deployment.md](deployment.md): reverse proxy and TLS.
