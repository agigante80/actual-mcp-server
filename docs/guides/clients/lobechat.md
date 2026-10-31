# LobeChat

LobeChat connects to a running server over HTTP. It is configured in its UI and has no environment interpolation, so the token is typed in and stored by LobeChat.

## Prerequisites

- The server running and healthy ([Run the server over HTTP](README.md#run-the-server-over-http)): `curl http://localhost:3600/health` answers.
- A bearer token that belongs to LobeChat alone: its own `MCP_STATIC_TOKENS` entry ([Pick a token](README.md#pick-a-token)).
- When LobeChat also runs in Docker, both containers on one network ([Connecting another container](../deployment.md#connecting-another-container-docker-network)). Use the server's container hostname, not a host IP.

## Configure

In the LobeChat UI:

1. Open **Settings**, then **Language Model**, then **Model Context Protocol**.
2. Click **Add Plugin**.
3. Fill in:
   - **Name**: `Actual Budget MCP`
   - **Server Type**: `HTTP`
   - **Server URL**: `http://actual-mcp-server-backend:3600/http`
   - **Authorization**: `Bearer ` followed by the token
4. Click **Save**.

Plain HTTP is for a Docker-internal network or loopback only, and it does not replace the token. Over any other network, use the `https://` URL ([HTTPS and reverse proxy](../deployment.md#https-and-reverse-proxy)).

Running the server without a token on a private network? It then answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]` (DNS rebinding protection, #612), so a request to `actual-mcp-server-backend` gets HTTP 403 `Invalid Host`. Set `MCP_ALLOWED_HOSTS=actual-mcp-server-backend` on the server, or configure a token.

**One plugin per assistant.** With `MCP_STATIC_TOKENS`, add the plugin once per assistant with that assistant's token in **Authorization** (the `MCP_TOKEN_HOUSEHOLD` value for the household assistant, the `MCP_TOKEN_BUSINESS` value for the business one). Each assistant then sees and switches only its own budgets; asking for another one is refused. The server still holds one open budget at a time, so two assistants working on different budgets take turns (each switch reloads the budget).

## Verify

LobeChat discovers the tools when you save: with every toolset published it lists 84 tools (fewer when `MCP_TOOLSETS`, `MCP_TOOLS` or `MCP_READ_ONLY` is set). Then ask `List my Actual Budget accounts and their balances.` The [shared verify step](README.md#verify) checks the server with `curl`.

## Troubleshooting

Logs: `docker logs` on the LobeChat container shows the plugin connection; the server's own log is `docker logs actual-mcp-server-backend`.

| Symptom | Cause | Fix |
|---------|-------|-----|
| Tools do not load | Wrong URL or network | Run the health check from the LobeChat container: `docker exec <lobechat-container> wget -qO- http://actual-mcp-server-backend:3600/health` |
| HTTP 401 | The token in **Authorization** differs from the server's, or lacks the `Bearer ` prefix | See [troubleshooting.md](../troubleshooting.md#http-401-unauthorized-invalid-token) |

Client-independent symptoms, including a session lost after a server restart, are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In LobeChat's own settings or database, in plaintext, on the LobeChat instance. Never screenshot the plugin form, export it into a committed file, or paste it into an issue. The least-bad option is to give LobeChat its own `MCP_STATIC_TOKENS` entry, so a leak is scoped to one principal and its budgets, and is revoked by changing one `MCP_TOKEN_*` variable and restarting the server.
