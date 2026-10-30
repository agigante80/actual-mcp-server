# Connect an AI client

Pick your client, then follow its page. Every page has the same sections: prerequisites, configure, verify, troubleshooting, and where the secret lives. The steps every client shares are below the table, written once.

> **New to Actual Budget?** Set it up first at [actualbudget.org](https://actualbudget.org/) before continuing.

| Client | Transport | Auth to this server | Page |
|--------|-----------|---------------------|------|
| Claude Desktop | stdio, or HTTP through `mcp-remote` | none (stdio), bearer token (HTTP) | [claude-desktop.md](claude-desktop.md) |
| Claude Code | stdio or HTTP | none (stdio), bearer token (HTTP) | [claude-code.md](claude-code.md) |
| Cursor | stdio | none | [cursor.md](cursor.md) |
| VS Code (GitHub Copilot) | stdio | none | [vscode-copilot.md](vscode-copilot.md) |
| Gemini CLI | stdio | none | [gemini-cli.md](gemini-cli.md) |
| OpenAI Codex | stdio or HTTP | none (stdio), bearer token (HTTP) | [codex.md](codex.md) |
| LibreChat | HTTP | bearer token or OIDC | [librechat.md](librechat.md) |
| LobeChat | HTTP | bearer token | [lobechat.md](lobechat.md) |

## How the two transports work

**stdio.** The client spawns `actual-mcp-server` as a child process:

```
AI Client  ──stdin──►  actual-mcp-server  ──►  Actual Budget
           ◄──stdout──
           ◄──stderr──  (logs only, not shown to user)
```

Requests travel over stdin, responses come back over stdout, and all server logs go to stderr (visible in each client's debug panel). There is no network port and no auth token; the OS process boundary is the security model. The client starts the server on launch and stops it on exit.

**HTTP** (`--http`). The server runs persistently, and clients connect over a network port with a bearer token:

```
┌─────────────┐   MCP/HTTP   ┌──────────────────┐   Actual API   ┌──────────────┐
│  AI Client  │ ◄──────────► │  Actual MCP      │ ◄───────────► │   Actual     │
│ (LibreChat  │              │  Server          │               │   Budget     │
│  LobeChat)  │              │  (84 tools)      │               │   Server     │
└─────────────┘              └──────────────────┘               └──────────────┘
```

The client speaks JSON-RPC 2.0 to the server, which turns each tool call into Actual Budget API requests.

| Transport | Startup | Auth | Best for |
|-----------|---------|------|----------|
| `--stdio` | Spawned by the client on demand | None (OS process) | Local single-user use: Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI, Codex |
| `--http` | Always-on service (Docker or systemd) | Bearer token or OIDC | Shared or multi-user deployments: LibreChat, LobeChat, remote access |

## Your Actual Budget credentials

Every client needs the same three values:

1. **Server URL**: where Actual Budget runs. Same computer: `http://localhost:5006`. Another machine on your network: `http://192.168.1.x:5006`.
2. **Server password**: the password you use to log in to Actual Budget (`ACTUAL_PASSWORD`).
3. **Budget Sync ID**: in Actual Budget open Settings, then Show Advanced Settings, and copy the Sync ID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

If the budget file is end-to-end encrypted, a fourth value, `ACTUAL_BUDGET_PASSWORD`, decrypts it. Every secret (the Actual password, the encryption password and the MCP bearer token) stays out of committed files, shell command lines and URLs. Each client page says where its secret lives.

## Prerequisites for stdio clients

- **Node.js 22 or later** ([download](https://nodejs.org/)). Check with `node --version`.
- The server through `npx` (nothing to install), or a clone built from source for development.
- **A data directory.** The server keeps a local SQLite copy of your budget here, and that copy is decrypted. Put it in a directory only your user can read, outside any repository or synced folder, and pass its absolute path as `MCP_BRIDGE_DATA_DIR`:

  ```bash
  install -d -m 700 /absolute/path/to/data-dir
  ```

  A relative path resolves against the client's working directory, which is unpredictable. There is no `.mcpignore` or similar file in the MCP ecosystem: the data directory is the only thing to keep out of version control. The repository's own `actual-data/` is in `.gitignore`; a path you choose elsewhere is not, so make sure nothing tracks it.

### Keep secrets in a user-only env file

The stdio pages that support environment references (Claude Code, Cursor, Gemini CLI, Codex) read the password from your environment. Keep it in one file only your user can read, and load it from your shell profile:

```bash
install -d -m 700 ~/.config/actual-mcp
touch ~/.config/actual-mcp/env && chmod 600 ~/.config/actual-mcp/env
```

Open `~/.config/actual-mcp/env` in an editor and add the values:

```dotenv
export ACTUAL_PASSWORD=your_actual_password
export ACTUAL_MCP_TOKEN=your_mcp_bearer_token
```

Then add `. ~/.config/actual-mcp/env` to `~/.bashrc` or `~/.zshrc`, and start the client from a new shell. Never commit this file or paste it into an issue.

## Run the server over HTTP

Claude Desktop through `mcp-remote`, Claude Code and Codex over HTTP, LibreChat and LobeChat all connect to a running server. Start it in Docker.

First create `.env` with a generated token: run the step 1 block of the [README Docker quick start](../../../README.md#option-a-docker-recommended). It prints the token. Then fill in `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_SYNC_ID` and `ACTUAL_SERVER_URL` in `.env`. Inside the container `localhost` is the container itself, so use your Actual server's LAN address or domain, or `http://host.docker.internal:5006` when Actual runs on the Docker host. Then, in the directory that holds `.env`:

<!-- runnable: http-docker-run -->
```bash
docker run -d \
  --name actual-mcp \
  --restart unless-stopped \
  -p 3600:3600 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -v actual-mcp-data:/app/data \
  ghcr.io/agigante80/actual-mcp-server:latest
```

After a few seconds, `curl http://localhost:3600/health` answers `{"status":"ok","transport":"streamable-http", ...}`.

When the client and the server both run in Docker, use the server's container hostname instead of a host address; [Connecting another container](../deployment.md#connecting-another-container-docker-network) shows the shared network.

### Pick a token

- **One client:** the generated `MCP_SSE_AUTHORIZATION` token is enough.
- **More than one client:** give each client its own token with `MCP_STATIC_TOKENS`. Each token is its own principal with its own budget list, so a leak is scoped to one client and revoked by changing one variable. This is the default whenever a second client connects. See [One token per client](../authentication.md#one-token-per-client-mcp_static_tokens).
- **Many users with an identity provider:** OIDC, see [OIDC multi-user setup](../authentication.md#oidc-multi-user-setup).

### Plain HTTP and HTTPS

Plain HTTP is for loopback or a Docker-internal network only, and it never replaces the token: every HTTP example on these pages still sends one.

`mcp-remote` refuses a plain HTTP URL unless its arguments include `--allow-http`; without it you see `URL must use HTTPS`. Some versions of Claude Desktop enforce HTTPS at the app level instead (`URL must start with 'https'`).

For anything that leaves the host, serve HTTPS: natively with `MCP_ENABLE_HTTPS` (see [HTTPS/TLS](../../explanation/security-and-privacy.md#httpstls)) or behind a reverse proxy (see [HTTPS and reverse proxy](../deployment.md#https-and-reverse-proxy)).

## Verify

Check the server, then the tool list. Load the token from the env file above first, so it is never typed on the command line:

```bash
curl http://localhost:3600/health
# Expected: {"status":"ok","initialized":true,...}

curl -s -X POST http://localhost:3600/http \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACTUAL_MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import json,sys; data=json.load(sys.stdin); print(f'{len(data[\"result\"][\"tools\"])} tools loaded')"
```

With every toolset published, the `tools/list` response should list 84 tools, and a connected client shows 84 tools loaded with the `actual_` prefix. A smaller number is expected when `MCP_TOOLSETS`, `MCP_TOOLS` or `MCP_READ_ONLY` is set.

Then, in the client, open a new conversation and ask:

```
List my Actual Budget accounts and their balances.
```

The client calls the account tools and answers with your accounts. Other first questions to try:

```
How much did I spend last month, broken down by category?
I just paid $47.50 for groceries at Whole Foods. Add it to my budget.
```

## Troubleshooting

Client-specific checks, including where each client writes its logs, are on each client page. Symptoms that do not depend on the client (401, timeouts, connection refused, sync errors, a session lost after a restart) are in [troubleshooting.md](../troubleshooting.md).
