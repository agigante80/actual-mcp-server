# OpenAI Codex

Codex runs the server over stdio, or connects to a running HTTP server. Its config is TOML, not JSON, and has no value interpolation; instead it forwards named variables from the environment Codex was started in (`env_vars` for stdio, `bearer_token_env_var` for an HTTP bearer token). Example file: [examples/codex-config.toml](examples/codex-config.toml).

## Prerequisites

- Your Actual Budget server URL, password and Sync ID ([credentials](README.md#your-actual-budget-credentials)).
- stdio: Node.js 22 or later and an absolute, user-only data directory ([stdio prerequisites](README.md#prerequisites-for-stdio-clients)).
- HTTP: the server running ([Run the server over HTTP](README.md#run-the-server-over-http)) and its bearer token.
- The secrets in your environment, loaded from the user-only file `~/.config/actual-mcp/env` ([how](README.md#keep-secrets-in-a-user-only-env-file)). Start Codex from a shell that has them.

## Configure

### stdio

Edit `~/.codex/config.toml`. `env_vars` forwards `ACTUAL_PASSWORD` by name; the `env` table holds only non-secret values:

```toml
[mcp_servers.actual-budget]
command = "npx"
args = ["-y", "actual-mcp-server", "--stdio"]
startup_timeout_sec = 30
env_vars = ["ACTUAL_PASSWORD"]

[mcp_servers.actual-budget.env]
ACTUAL_SERVER_URL = "http://localhost:5006"
ACTUAL_BUDGET_SYNC_ID = "your-sync-id-here"
MCP_BRIDGE_DATA_DIR = "/absolute/path/to/data-dir"
```

No `type` field is needed: Codex infers stdio from `command`. `startup_timeout_sec = 30` gives the server time to initialise on first run. Because this file holds no secret, the same content may go in a trusted project's `.codex/config.toml`; never add a password or token to either file.

From the CLI, `codex mcp add` takes only the non-secret values; add the `env_vars` line to the TOML afterwards:

```bash
codex mcp add actual-budget \
  --env ACTUAL_SERVER_URL=http://localhost:5006 \
  --env ACTUAL_BUDGET_SYNC_ID=your-sync-id-here \
  --env MCP_BRIDGE_DATA_DIR=/absolute/path/to/data-dir \
  -- npx -y actual-mcp-server --stdio
```

**Linux with NVM:** Codex does not load your shell profile. If the system Node is older than 22 or missing, `npx` fails. Use the absolute path instead, found with `which actual-mcp-server` after `npm install -g actual-mcp-server`: `command = "/home/YOUR_USER/.nvm/versions/node/v22.22.2/bin/actual-mcp-server"` and `args = ["--stdio"]`.

### HTTP

`--bearer-token-env-var` stores the variable's name, not its value:

```bash
codex mcp add actual-budget --url http://localhost:3600/http --bearer-token-env-var ACTUAL_MCP_TOKEN
```

The resulting TOML is `url = "http://localhost:3600/http"` and `bearer_token_env_var = "ACTUAL_MCP_TOKEN"`. Plain HTTP is for loopback or a Docker-internal network only, and it does not replace the token.

These keys were checked with codex-cli 0.164.0: `codex mcp get --json` reads `env_vars` and `bearer_token_env_var` back from the file.

## Verify

Run `codex mcp list` to confirm the server is registered, then ask `List my Actual Budget accounts and their balances.` More first questions are in the [shared verify step](README.md#verify).

## Troubleshooting

Logs: the server's stderr appears in the terminal running Codex.

| Symptom | Cause | Fix |
|---------|-------|-----|
| The server fails to authenticate to Actual | `ACTUAL_PASSWORD` is not in the shell that started Codex | Source `~/.config/actual-mcp/env` and start Codex again |
| `connection closed: initialize response` | Server older than 0.5.2 wrote to stdout and corrupted JSON-RPC | Upgrade: `npx -y actual-mcp-server@latest --stdio`, or the absolute NVM path |
| `ReferenceError: File is not defined` and `Node.js v18.x` | Node is older than 22 | Use the absolute NVM path |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set an absolute path |

Client-independent symptoms are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In your environment only, loaded from `~/.config/actual-mcp/env` (mode 600, outside any repository). `config.toml` names the variables (`env_vars`, `bearer_token_env_var`) and never holds their values. Never commit the env file or paste it into an issue.
