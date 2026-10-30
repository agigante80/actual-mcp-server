# LibreChat

LibreChat connects to a running server over HTTP (Streamable HTTP). It replaces `${VAR}` placeholders in `librechat.yaml`, headers included, with values from its own `.env`, so the YAML holds no token. Example file: [examples/librechat.yaml](examples/librechat.yaml).

## Prerequisites

- The server running and healthy ([Run the server over HTTP](README.md#run-the-server-over-http)): `curl http://localhost:3600/health` answers.
- A bearer token for LibreChat: its own `MCP_STATIC_TOKENS` entry when more than one client connects ([Pick a token](README.md#pick-a-token)), or OIDC.
- When LibreChat also runs in Docker, both containers on one network ([Connecting another container](../deployment.md#connecting-another-container-docker-network)). Use the server's container hostname, not a host IP.

## Configure

Add the token to LibreChat's `.env` as `ACTUAL_MCP_TOKEN`, then add the server to `librechat.yaml`:

```yaml
mcpServers:
  actual-mcp:
    type: "streamable-http"
    # Container hostname on a shared Docker network; otherwise the host IP or domain
    url: "http://actual-mcp-server-backend:3600/http"
    headers:
      Authorization: "Bearer ${ACTUAL_MCP_TOKEN}"
    serverInstructions: true
    timeout: 600000  # 10 minutes: budget operations can be slow
```

Plain HTTP is for a Docker-internal network or loopback only, and it does not replace the token. Over any other network, use the `https://` URL ([HTTPS and reverse proxy](../deployment.md#https-and-reverse-proxy)).

`serverInstructions: true` makes LibreChat add the server's `initialize` instructions to the system prompt. LibreChat leaves them out by default. The text is short and is built from the tools the server actually publishes, so it tracks `MCP_TOOLSETS`, `MCP_TOOLS` and `MCP_READ_ONLY`: call `actual_get_context` first and use the ids it returns, amounts are integer cents, dates are `YYYY-MM-DD`, and filter `actual_query_run` on id columns.

**Recommended for LibreChat:** set `MCP_TOOLSETS=chat` on the MCP server. LibreChat works better with a small tool list; the `chat` preset publishes a small set (about a quarter of the `tools/list` payload) and covers everyday transaction, rule and budget work. Add specific tools with `MCP_TOOLS` if you need them. See [Reducing the tool surface](../../../README.md#reducing-the-tool-surface).

Then restart LibreChat (for example `docker restart ai-librechat`).

**One entry per token.** With `MCP_STATIC_TOKENS`, add one `mcpServers` entry per token, each with its own `${...}` reference in `.env`. Each entry then sees and switches only its own budgets; asking for another one is refused. The server still holds one open budget at a time, so entries working on different budgets take turns (each switch reloads the budget).

### LibreChat with OIDC

When `AUTH_PROVIDER=oidc` is set on the MCP server, configure the OIDC MCP instance through the LibreChat admin UI (OAuth flow); the server side is in [OIDC multi-user setup](../authentication.md#oidc-multi-user-setup). For a static-token fallback entry beside it:

```yaml
mcpServers:
  actual-bearer:
    type: "streamable-http"
    url: "http://actual-mcp-server-backend:3600/http"
    headers:
      Authorization: "Bearer ${ACTUAL_MCP_TOKEN}"
    serverInstructions: false
```

This entry sets `serverInstructions: false`, which turns the server's instructions off for it. Set it to `true` to get them, as in the first example.

## Verify

With every toolset published, the LibreChat UI shows **84 tools** listed under the MCP server entry (fewer when `MCP_TOOLSETS`, `MCP_TOOLS` or `MCP_READ_ONLY` is set). Then ask `List my Actual Budget accounts and their balances.` The [shared verify step](README.md#verify) checks the server with `curl`.

## Troubleshooting

Logs: `docker logs` on the LibreChat container shows the MCP connection; the server's own log is `docker logs actual-mcp-server-backend`.

| Symptom | Cause | Fix |
|---------|-------|-----|
| 0 tools loaded | Wrong transport type | Use `type: "streamable-http"` (not `"sse"`) |
| Tools do not load | Wrong URL or network | Run the health check from the LibreChat container: `docker exec <librechat-container> wget -qO- http://actual-mcp-server-backend:3600/health` |
| HTTP 401 | `ACTUAL_MCP_TOKEN` in LibreChat's `.env` differs from the server's token | See [troubleshooting.md](../troubleshooting.md#http-401-unauthorized-invalid-token) |
| Timeout errors | Slow Actual Budget server | Raise `timeout` in the entry (the example uses 10 minutes) |

Client-independent symptoms, including a session lost after a server restart, are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In LibreChat's own `.env` on the LibreChat host, as `ACTUAL_MCP_TOKEN`. `librechat.yaml` holds only the `${ACTUAL_MCP_TOKEN}` reference, so it is safe to commit. Keep the `.env` readable only by the LibreChat service user, never commit it, and never paste it into an issue. If your LibreChat version does not expand `${VAR}` in `headers`, the token ends up in plaintext in `librechat.yaml`; treat that file the same way.
