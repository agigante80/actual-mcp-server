# Authentication

How a client proves who it is to this server, and which budgets each mode lets it reach. This guide is the task view; the full model, threat analysis and history live in [explanation/security-and-privacy.md](../explanation/security-and-privacy.md). Every variable named here is listed in [reference/configuration.md](../reference/configuration.md).

## Pick a mode

| Mode | Transport | Configure | Who the caller is | Budgets it can reach |
|------|-----------|-----------|-------------------|----------------------|
| stdio | stdio | nothing (the client launches the process) | the local user | every configured budget |
| Shared token | HTTP | `MCP_SSE_AUTHORIZATION` | one principal, `static-bearer`, for every client | every configured budget |
| One token per client | HTTP | `MCP_STATIC_TOKENS` plus one `MCP_TOKEN_*` per client | the JSON key of the matching entry | only the budgets in that entry's `budgets` list |
| OIDC | HTTP | `AUTH_PROVIDER=oidc` plus `OIDC_ISSUER` and the other `OIDC_*` settings | the verified JWT subject | with the default `AUTH_BUDGET_ACL_SOURCE=static`, every budget when `AUTH_BUDGET_ACL` is unset, empty or `{}`, otherwise only what it grants; with `AUTH_BUDGET_ACL_SOURCE=actual`, the budgets Actual grants that user |
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
- `tokenEnv` must match `^MCP_TOKEN_[A-Z0-9_]+$` (upper case letters, digits and `_` after the prefix), so it cannot point at `ACTUAL_PASSWORD`. `MCP_TOKEN_alice` refuses startup.
- The token it names is set, at least 32 characters, uses only RFC 6750 token characters, and is unique across all principals and `MCP_SSE_AUTHORIZATION`.
- The principal name `static-bearer` is reserved for the shared token.
- `MCP_STATIC_TOKENS` is refused together with `AUTH_PROVIDER=oidc`, where the verified JWT decides the principal.

Each client then sends its own token: one plugin per assistant in [LobeChat](clients/lobechat.md), one `mcpServers` entry per token in [LibreChat](clients/librechat.md). A budget outside the list is refused on every operation, a switch to one returns the same "not found" as a name that does not exist, and the budget listings show only the permitted budgets. The server still holds one open budget at a time, so two clients working on different budgets take turns (each switch reloads the budget). `MCP_SSE_AUTHORIZATION` may stay set beside it while clients move over one at a time; the startup log flags it as unrestricted. Limitations (no in-process rate limiter, a shared session pool, one open budget per process) are listed under "One static token per client" in [security-and-privacy.md](../explanation/security-and-privacy.md).

## OIDC

Set `AUTH_PROVIDER=oidc` and the issuer settings. The walkthrough, including Casdoor and Cloudflare, is in [OIDC multi-user setup](#oidc-multi-user-setup) below, and the LibreChat side is in [clients/librechat.md](clients/librechat.md); the model is under "OIDC / JWT Authentication" in [security-and-privacy.md](../explanation/security-and-privacy.md).

Budget scope depends on `AUTH_BUDGET_ACL_SOURCE` (`src/auth/budget-acl.ts`).

With the default, `static`, it comes from `AUTH_BUDGET_ACL`:

- **Unset, an empty string, or `{}` is open**: every authenticated user may reach every budget. This is fail-open by design, so configure the ACL before you rely on it to cut anyone off.
- **A non-empty JSON object restricts.** It maps a principal to an array of budget sync ids; `"*"` grants every budget. The principals of a request are the JWT `sub`, the `email` claim, and `group:<name>` for each entry of the `groups` claim. The `roles` claim is read only when the token has no `groups` claim, or a `null` one, and either claim counts only when it is a JSON array. A user who matches nothing gets HTTP 403.
- **An invalid value refuses startup** (#551), on HTTP and stdio alike, whatever `AUTH_PROVIDER` or `AUTH_BUDGET_ACL_SOURCE` is set to.

With **`AUTH_BUDGET_ACL_SOURCE=actual`**, `AUTH_BUDGET_ACL` is not consulted at all, not even when it is unset or `{}`: each request gets exactly the budgets whose access list on the Actual server includes that user. A user with none, or a lookup that fails, gets HTTP 403. The identity settings for this mode are in [configuration.md](../reference/configuration.md) and under "Identity matching for the dynamic ACL" in [security-and-privacy.md](../explanation/security-and-privacy.md).

## OIDC multi-user setup

> **This is inbound auth only.** `AUTH_PROVIDER=oidc` controls how MCP **clients** authenticate
> **to this server**. It does not change how this server authenticates **to Actual Budget**, which
> is always `ACTUAL_PASSWORD`. The two are independent: you can run OIDC here with a
> password-authenticated Actual upstream, and enabling OIDC on your Actual Budget server does not
> remove this server's need for `ACTUAL_PASSWORD`. A third credential,
> `ACTUAL_BUDGET_PASSWORD`, is unrelated to both: it decrypts an E2E-encrypted budget file.

For multi-user deployments with an OIDC provider (Casdoor, Keycloak, Auth0 and others):

```bash
# .env
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://sso.yourdomain.com
OIDC_RESOURCE=https://actual-mcp.yourdomain.com/http   # this server's public MCP URL: the expected 'aud'
OIDC_ACCEPTED_AUDIENCES=your-client-id                  # only if your IdP puts the client id in 'aud' (#245)
OIDC_SCOPES=                          # leave empty when the tokens carry no 'scope' claim
# Only for IdPs whose JWKS lives on a different host than the issuer (#254).
# Google: issuer accounts.google.com serves keys from www.googleapis.com:
# OIDC_JWKS_TRUSTED_HOSTS=www.googleapis.com
```

**`OIDC_RESOURCE` is a URL, not a client id (#461).** It is the canonical URL of this MCP server
(RFC 9728 resource identifier, RFC 8707 resource indicator, the MCP authorization spec's "canonical
server URI"). Two things derive from it: the well-known route where the protected-resource metadata
is published, and the `aud` value a standards client asks your IdP to mint. A value that is not an
absolute http(s) URL refuses to start with a message naming the variable. If your IdP ignores the
`resource` parameter and puts the client id in `aud` (Authentik, Cloudflare Access, Casdoor before
v2.318.0 and others do), keep `OIDC_RESOURCE` as the URL and add the client id to `OIDC_ACCEPTED_AUDIENCES`.

**How a standards client discovers this server.** A client connecting to
`https://actual-mcp.yourdomain.com/http` sends a request without a token, gets `401` with
`WWW-Authenticate: Bearer resource_metadata="https://actual-mcp.yourdomain.com/.well-known/oauth-protected-resource/http"`,
fetches that document, reads `authorization_servers`, fetches the IdP's RFC 8414 metadata, and
runs the OAuth flow with `resource=<the document's resource value>`. The document's route follows
`OIDC_RESOURCE` (RFC 9728 section 3.1):

| `OIDC_RESOURCE` | Document served at | Who it works for |
|---|---|---|
| `https://host/http` (recommended, the endpoint form) | `/.well-known/oauth-protected-resource/http`, plus the same document at the root `/.well-known/oauth-protected-resource` (#473) | Every client: the path-specific URL strict clients look for and the official MCP SDK's first attempt, and the root copy for clients that look only there (Google Gemini) |
| `https://host` (the origin form) | `/.well-known/oauth-protected-resource` | Clients that fall back to the root (the official MCP SDK does); a client without that fallback fails discovery |

Use the endpoint form without a trailing slash. The server logs one warning at startup when the
identifier's path differs from the advertised MCP path, naming the recommended value. Behind a
reverse proxy that rewrites the MCP path (`MCP_BRIDGE_HTTP_PATH` differs from `MCP_HTTP_PATH`), the
proxy must forward `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
to the server UNREWRITTEN; the server mounts the path-specific document at the path taken from
`OIDC_RESOURCE`, which is the public path.

**Behind Cloudflare Access (Managed OAuth), #462.** Cloudflare's documented pattern for an MCP server is
different from a plain OIDC resource server, and it needs a different configuration. With Managed OAuth
enabled on the Access application, Cloudflare serves the OAuth discovery to the MCP client at your app
domain, the client obtains an OPAQUE access token (`oauth:...`, not a JWT, by design) and sends it as the
bearer, Cloudflare resolves it at the edge and forwards the signed Access JWT to your origin in the
`Cf-Access-Jwt-Assertion` header, and "the MCP server must validate the Access JWT sent in the
Cf-Access-Jwt-Assertion header". Do NOT configure an Access-for-SaaS OIDC application as the issuer for
this server: its access tokens are opaque, cannot be verified by JWKS, and it publishes no introspection
endpoint. Configure this instead:

```bash
AUTH_PROVIDER=oidc
OIDC_TOKEN_SOURCE=cf-access-jwt-assertion                      # read the JWT Cloudflare forwards, never the opaque bearer
OIDC_ISSUER=https://<team>.cloudflareaccess.com                # the assertion's iss (your Zero Trust team domain)
OIDC_JWKS_URI=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs   # no discovery document on the team domain
OIDC_ACCEPTED_AUDIENCES=<Application Audience (AUD) tag>       # the assertion's aud: Zero Trust > Access > Applications > your app > Additional settings
OIDC_RESOURCE=https://<app-domain>/http                        # this server's URL (#461); it is not the aud in this mode
OIDC_SCOPES=                                                   # MUST be empty: the assertion carries no scope claim
AUTH_BUDGET_ACL={"alice@example.com":["<sync-id>"]}            # the assertion carries sub and email; key the ACL on the email, or on the Cloudflare sub
```

Rules the server enforces at startup in this mode: `OIDC_SCOPES` must be empty, `AUTH_BUDGET_ACL_IDENTITY_SOURCE`
must stay `token`, and both new variables require `AUTH_PROVIDER=oidc`. In this mode the `Authorization`
header is never consulted (no fallback), `/.well-known/oauth-authorization-server` is not served by this
server (Cloudflare serves discovery at the edge), and the assertion is verified exactly like any bearer
JWT: signature against `OIDC_JWKS_URI`, `iss` pinned to `OIDC_ISSUER`, `aud` in the closed allowlist,
non-empty `sub`.

**The origin must be reachable only through Cloudflare.** This mode trusts a header that Cloudflare
sets; the signature stops forgery, but a captured assertion is accepted at a directly reachable origin
until its `exp` (the Access application's Session Duration, default 24 hours, configurable up to one
month: set it short), the AUD tag is not a secret (it is in every assertion), and a client-supplied
`Cf-Access-Jwt-Assertion` is overwritten by Cloudflare only when the request traverses Cloudflare. So
the mode is NOT a substitute for network restriction: reach the origin only through a Cloudflare Tunnel
or a Cloudflare IP allowlist.

**Per-user budget access control** (`AUTH_BUDGET_ACL`) follows the rules in the [OIDC](#oidc) section above. A key is an `email` claim, a `sub` claim, or `group:<name>`:

```bash
AUTH_BUDGET_ACL={"alice@example.com":["budget-uuid-1"],"group:admins":["*"]}
```

**Casdoor note**: Casdoor copies the scopes of the authorization request into the access token's `scope` claim, so `OIDC_SCOPES` works for scopes your clients request; if the Casdoor application defines a Scopes list, each requested scope must be on it. When clients request no scope the claim is absent: set `OIDC_SCOPES=` (empty string) to disable scope enforcement, and use `OIDC_SCOPES_SUPPORTED` if clients need scopes advertised in discovery. Since v2.318.0 Casdoor honors the RFC 8707 `resource` parameter and puts it in `aud`, so `OIDC_ACCEPTED_AUDIENCES` is only needed for older versions or clients that send no `resource`.

**OAuth discovery for Claude.ai and mcp-remote (#285)**: with `AUTH_PROVIDER=oidc`, the server automatically publishes both OAuth metadata documents a client needs to start a login: `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414). The RFC 8414 document is re-served from your IdP's own OpenID discovery doc, which lets clients that resolve that path against the resource-server origin (and IdPs like Authentik that do not expose it where clients look) complete the flow. No configuration is required: point your OIDC client at the server's base URL and it discovers `OIDC_ISSUER`'s `authorization_endpoint` and `token_endpoint` automatically. If a client cannot find the token endpoint against a bare-OIDC IdP, confirm `AUTH_PROVIDER=oidc` is set (the endpoints exist only in OIDC mode).

### Cloudflare Access for SaaS and Google Gemini

When connecting Google Gemini's custom MCP connector to Actual MCP Server authenticated via Cloudflare Access for SaaS:

1. **Audience**: Cloudflare mints access token JWTs with the `aud` claim set to the OAuth client's redirect URI (`https://oauth-redirect.googleusercontent.com/r/...`), rather than the resource URL or SaaS application ID. Set `OIDC_ACCEPTED_AUDIENCES` to this redirect URI.
2. **Scopes**: Cloudflare access token JWTs omit the `scope` claim. Set `OIDC_SCOPES=` (empty) so the server enforces no scope requirements.
3. **Refresh Tokens**: Gemini requires a refresh token for account linking and will only request one if `offline_access` is advertised in `scopes_supported`. Set `OIDC_SCOPES_SUPPORTED=openid,email,profile,offline_access` so `offline_access` is advertised in discovery without causing `missing_required_scopes` errors. The refresh token this unlocks is long-lived and lives at the IdP: this server validates access tokens only and cannot revoke it, so a compromised client keeps minting access tokens until you revoke its refresh token in Cloudflare Access (or your IdP). Advertise `offline_access` only for clients that need it. See [Limiting a leaked refresh token](../explanation/security-and-privacy.md#limiting-a-leaked-refresh-token-488) for the token lifetimes to set at the IdP and the order of steps if a client is compromised.

```dotenv
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<app-id>
OIDC_RESOURCE=https://<app-domain>/http
OIDC_ACCEPTED_AUDIENCES=https://oauth-redirect.googleusercontent.com/r/<client-specific-suffix>
OIDC_SCOPES=                                                  # enforce nothing: JWT has no scope claim
OIDC_SCOPES_SUPPORTED=openid,email,profile,offline_access     # advertise offline_access so client gets a refresh token
```

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
