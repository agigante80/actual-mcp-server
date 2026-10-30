# Claude Desktop

Claude Desktop runs the server as a child process over stdio (recommended for local use), or connects to a running HTTP server through `mcp-remote`. Example file: [examples/claude-desktop.json](examples/claude-desktop.json) (both entries).

## Prerequisites

- Your Actual Budget server URL, password and Sync ID ([credentials](README.md#your-actual-budget-credentials)).
- stdio: Node.js 22 or later and an absolute, user-only data directory ([stdio prerequisites](README.md#prerequisites-for-stdio-clients)).
- HTTP: the server running in Docker ([Run the server over HTTP](README.md#run-the-server-over-http)) and its bearer token.

## Configure

Edit the config file, then fully restart Claude Desktop. Close it before editing: changes take effect only on restart.

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Option A: stdio (recommended)

`npx` downloads and caches the package on first use. No Docker, no HTTP server and no token:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

From a local clone instead (development or a pinned version), build it first (`git clone https://github.com/agigante80/actual-mcp-server && cd actual-mcp-server && npm install && npm run build`), then use `"command": "node"` and `"args": ["/absolute/path/to/actual-mcp-server/dist/src/index.js", "--stdio"]` with the same `env` block. Run `pwd` in the repository to find the absolute path.

`MCP_BRIDGE_DATA_DIR` must be absolute: a relative path resolves against Claude Desktop's working directory (usually your home directory).

### Option B: HTTP through mcp-remote

Use this when the server already runs in Docker. The token sits in the `env` block, and the argument list only references it, so it is not in the args or the process listing. Keeping the space of `Bearer <token>` in `env` also avoids `mcp-remote`'s Windows bug with spaces inside arguments:

```json
{
  "mcpServers": {
    "actual-budget-http": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3600/http",
        "--allow-http",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer your_secret_token"
      }
    }
  }
}
```

Plain HTTP is for loopback or a Docker-internal network only, and it does not replace the token. `--allow-http` is required for a plain HTTP URL. For an HTTPS server (`MCP_ENABLE_HTTPS=true` or a reverse proxy), use the `https://` URL, drop `--allow-http`, and, for a self-signed certificate, add `"NODE_EXTRA_CA_CERTS": "/path/to/your/cert.pem"` to `env`.

### Linux with NVM

Claude Desktop does not load NVM or `.bashrc`, so `npx` resolves to the system binary. If your system Node is older than 22, use the absolute NVM path for `command` (for example `/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/npx`). For `mcp-remote` also set `PATH` in `env` to that `bin` directory, because its shebang resolves `node` through `PATH`.

## Verify

Open a new conversation and ask `List my Actual Budget accounts and their balances.` Claude calls the account tools and lists your accounts. More first questions are in the [shared verify step](README.md#verify).

## Troubleshooting

Logs: on macOS open **Developer, Open MCP Log File**; on Linux read `~/.config/Claude/logs/mcp-server-actual-budget.log`.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ReferenceError: File is not defined` and `Node.js v18.x` | Node is older than 22 | Use the absolute NVM path for `command` |
| `URL must use HTTPS` | `--allow-http` is missing | Add `"--allow-http"` to `args` |
| `URL must start with 'https'` | This Claude Desktop version enforces HTTPS | Serve HTTPS, or use Option A |
| `SSL certificate problem` | Wrong path in `NODE_EXTRA_CA_CERTS` | Check the path with `ls -la /path/to/cert.pem` |
| Server starts but no tools appear | The config was not reloaded | Fully quit and restart Claude Desktop |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set an absolute path |
| `ENOENT` or a permission error at startup | The data directory does not exist | Create it, then restart |
| Nothing loads after an edit | A JSON syntax error | Validate the file (see [troubleshooting.md](../troubleshooting.md#a-client-config-file-is-ignored)) |

Client-independent symptoms, including a session lost after a server restart, are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

Claude Desktop has no environment interpolation in `claude_desktop_config.json`, so `ACTUAL_PASSWORD` (and `ACTUAL_BUDGET_PASSWORD` for an encrypted budget) for stdio, and the bearer token in `AUTH_HEADER` for HTTP, are stored in plaintext in that file. It lives in your home directory: keep it mode 600 (`chmod 600` on the path above), never commit it, and never paste it into an issue. Keep `ACTUAL_BUDGET_SYNC_ID` out of shared files as well. Nothing here protects the file beyond your user account's permissions.
