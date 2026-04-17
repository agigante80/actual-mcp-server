# Connect Any AI Client to Your Budget

This guide walks you through connecting **Claude Desktop, Cursor, VS Code (GitHub Copilot), Gemini CLI, and Claude Code** to your **Actual Budget** instance using the Actual MCP Server. Once set up, you can manage your budget conversationally — ask questions, log expenses, analyse spending — all in plain English.

> **New to Actual Budget?** Set it up first at [actualbudget.org](https://actualbudget.org/) before continuing.

---

## How stdio transport works

All AI clients that use the stdio transport follow the same model:

```
AI Client  ──stdin──►  actual-mcp-server  ──►  Actual Budget
           ◄──stdout──
           ◄──stderr──  (logs only, not shown to user)
```

The client **spawns actual-mcp-server as a child process**. Requests travel over **stdin**, responses come back over **stdout**, and all server logs go to **stderr** (visible in each client's debug panel). There is no network port, no auth token — the OS process boundary is the security model. The client starts the server on launch and kills it on exit.

This is in contrast to the **HTTP transport** (`--http`), where the server runs persistently and clients connect over a network port with a Bearer token.

| Transport | Startup | Auth | Best for |
|-----------|---------|------|----------|
| `--stdio` | Spawned by client on demand | None (OS process) | Local single-user use: Claude Desktop, Cursor, VS Code, Gemini CLI |
| `--http` | Always-on service (Docker/systemd) | Bearer token or OIDC | Multi-user deployments: LibreChat, LobeChat, remote access |

---

## Prerequisites (all options)

- ✅ **Actual Budget** running (local or self-hosted) — [setup guide](https://actualbudget.org/docs/install/)
- ✅ Your **Budget Sync ID**: Actual → Settings → Show Advanced Settings → Sync ID
- ✅ Your **server URL** and **password** for Actual Budget

For stdio options (Sections 1–4 below):
- ✅ **Node.js 20+** — [download](https://nodejs.org/). Check with `node --version`
- ✅ The server available via `npx` (no install needed) — or cloned and built from source for development
- ✅ **Data directory created** — pick an absolute path and create it before starting:
  ```bash
  mkdir -p /absolute/path/to/data-dir
  ```
  This is where the server stores a local SQLite copy of your budget. The server will create it automatically if missing, but doing it explicitly avoids permission issues on first run.

For HTTP options (Docker-based):
- ✅ **Docker** — [get Docker](https://docs.docker.com/get-docker/)

---

## Find your Actual Budget credentials

You'll need three pieces of information regardless of which client you use:

1. **Server URL** — where Actual Budget is running
   - Same computer: `http://localhost:5006`
   - Another machine on your network: `http://192.168.1.x:5006`

2. **Server password** — the password you use to log in to Actual Budget

3. **Budget Sync ID** — open Actual Budget → Settings → Show Advanced Settings → copy the Sync ID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

---

## Claude Desktop

### Option A — stdio (native, recommended for local use)

Claude Desktop spawns the server as a child process. No Docker, no HTTP server, no token required.

**Config file location:**

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

> **Close Claude Desktop before editing** — config changes only take effect on restart.

#### Via npx (no clone or build required)

The simplest option — `npx` downloads and caches the package automatically on first use:

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

> **Linux with NVM?** Claude Desktop does not load NVM or `.bashrc`, so `npx` resolves to the system binary. If your system Node is older than v20, use the absolute NVM path: `/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/npx`

#### Via local clone (for development or pinned version)

Clone and build first: `git clone https://github.com/agigante80/actual-mcp-server && cd actual-mcp-server && npm install && npm run build`

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/absolute/path/to/actual-mcp-server/dist/src/index.js", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/actual-mcp-server/actual-data"
      }
    }
  }
}
```

Run `pwd` in the repo directory to find the absolute path.

> **Linux with NVM?** Use the absolute NVM path for `command`: `/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/node`

> **Why `MCP_BRIDGE_DATA_DIR` must be absolute**: The server downloads a local copy of your budget data here. Without an absolute path it resolves relative to Claude Desktop's working directory (usually `$HOME`), which is unpredictable. Create the directory before first run: `mkdir -p /absolute/path/to/data-dir`

**No auth token needed.** Only Claude Desktop (the spawning process) can communicate with the server via its stdin/stdout.

**Security note**: the config file is readable only by your user account. Keep `ACTUAL_PASSWORD` and `ACTUAL_BUDGET_SYNC_ID` out of shared config files or version control.

**To see server logs** during troubleshooting: in Claude Desktop open **Developer → Open MCP Log File** (macOS) or check `~/.config/Claude/logs/mcp-server-actual-budget.log` (Linux).

---

### Option B — HTTPS via mcp-remote (when server is running in Docker)

Use this when the MCP server is already running as a Docker container with `MCP_ENABLE_HTTPS=true`.

First, [start the Docker container](#starting-the-docker-container) below.

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://localhost:3601/http",
        "--header",
        "Authorization: Bearer your_secret_token"
      ],
      "env": {
        "NODE_EXTRA_CA_CERTS": "/path/to/your/cert.pem"
      }
    }
  }
}
```

> **Linux with NVM?** Use the absolute NVM path for `command` and set `PATH` explicitly in `env` (see Linux NVM note in Option A above — same issue applies to `npx`). The `PATH` is also required because `mcp-remote`'s shebang resolves `node` via PATH at runtime.

---

### Option C — Plain HTTP via mcp-remote

Use this for HTTP-only Docker deployments. The `--allow-http` flag is required — `mcp-remote` enforces HTTPS by default.

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3600/http",
        "--header",
        "Authorization: Bearer your_secret_token",
        "--allow-http"
      ]
    }
  }
}
```

> **`--allow-http` is required.** Without it you'll see `URL must use HTTPS`. If Claude Desktop itself shows `URL must start with 'https'`, switch to Option B.

---

### Starting the Docker container

Required for Options B and C. Skip this if you're using Option A (stdio).

```bash
# Generate a token
openssl rand -hex 32

# Start the server
docker run -d \
  --name actual-mcp \
  --restart unless-stopped \
  -p 3600:3600 \
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  -e ACTUAL_PASSWORD=your_actual_password \
  -e ACTUAL_BUDGET_SYNC_ID=your-sync-id \
  -e MCP_SSE_AUTHORIZATION=your_secret_token \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest

# Verify
curl http://localhost:3600/health
# Expected: {"status":"ok","transport":"http","version":"..."}
```

---

### Verify and first questions

After restarting Claude Desktop, open a new conversation and type:

```
Can you check if you're connected to my Actual Budget?
```

Claude will call `actual_server_info` and report back. Then try:

```
What's my current balance for all accounts?
How much did I spend last month, broken down by category?
I just paid $47.50 for groceries at Whole Foods. Add it to my budget.
```

---

## Cursor

Cursor reads MCP configuration from `.cursor/mcp.json` in your project root or `~/.cursor/mcp.json` globally.

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

Cursor starts the MCP server when a project with this config is opened and stops it on close. To see server logs: **View → Output → MCP: actual-budget**.

> **NVM note**: Cursor may not load your shell profile. If `npx` resolves to a system binary older than v20, use the absolute NVM path: `/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/npx`.

---

## VS Code — GitHub Copilot

GitHub Copilot in VS Code reads MCP configuration from **`.copilot/mcp-config.json`** in your project root (or the equivalent user-level location). It uses `mcpServers` as the root key and requires `"type": "stdio"` on each entry.

```json
{
  "mcpServers": {
    "actual-budget": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

> **NVM users**: VS Code / Copilot may not load your shell profile, so `npx` might resolve to a system binary older than v20. Use the absolute path to your nvm binary instead:
> ```json
> "command": "/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/actual-mcp-server",
> "args": ["--stdio"]
> ```
> Run `which actual-mcp-server` (after `npm install -g actual-mcp-server`) or `which npx` in your shell to find the correct path.

Commit `.copilot/mcp-config.json` to share the configuration with your team. If the file contains secrets, add it to `.gitignore` and have each team member fill in their own credentials.

To see server logs: **Output panel → MCP: actual-budget**.

---

## Gemini CLI

Gemini CLI reads MCP configuration from `~/.gemini/settings.json` (user-level) or `.gemini/settings.json` (project-level).

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      },
      "trust": true
    }
  }
}
```

> **`"trust"`** controls whether Gemini CLI prompts before running each tool. `true` = run automatically; `false` = ask each time. Set based on your comfort level.

Gemini CLI also supports environment variable expansion — useful to avoid hardcoding secrets in the file:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "$ACTUAL_SERVER_URL",
        "ACTUAL_PASSWORD": "$ACTUAL_PASSWORD",
        "ACTUAL_BUDGET_SYNC_ID": "$ACTUAL_BUDGET_SYNC_ID",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      },
      "trust": true
    }
  }
}
```

Set the variables in your shell profile (`.bashrc`, `.zshrc`) then `source` it before starting Gemini CLI:

```bash
export ACTUAL_SERVER_URL="http://localhost:5006"
export ACTUAL_PASSWORD="your_actual_password"
export ACTUAL_BUDGET_SYNC_ID="your-sync-id"
```

---

## Claude Code

Claude Code supports MCP servers via `.mcp.json` in your project root (project-scoped) or via `claude mcp add` (user-scoped). The config uses `mcpServers` as the root key and requires `"type": "stdio"`.

**`.mcp.json`** in your project root (recommended — version-controlled, shared with teammates):

```json
{
  "mcpServers": {
    "actual-budget": {
      "type": "stdio",
      "command": "npx",
      "args": ["actual-mcp-server@latest", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "your_actual_password",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

> **`actual-mcp-server@latest`** — using `@latest` ensures npx always runs the latest published version. Drop `@latest` to use whatever version npx has cached locally.

**Or add via CLI** (user-scoped, not project-specific):

```bash
claude mcp add actual-budget \
  --env ACTUAL_SERVER_URL=http://localhost:5006 \
  --env ACTUAL_PASSWORD=your_actual_password \
  --env ACTUAL_BUDGET_SYNC_ID=your-sync-id \
  --env MCP_BRIDGE_DATA_DIR=/absolute/path/to/data-dir \
  -- npx actual-mcp-server@latest --stdio
```

Verify with `claude mcp list` to confirm the server is registered.

---

## OpenAI Codex

Codex supports MCP servers via `codex mcp add` (CLI) or by editing `~/.codex/config.toml` directly. Unlike all other clients, Codex uses **TOML** (not JSON).

> **Important — NVM users**: Codex is Python-based and does **not** load your shell profile or NVM. Using bare `npx` will likely fail with a silent startup error because `npx` resolves to the system binary with an older Node.js version. **Use the absolute path to your NVM binary instead.**

First, create the data directory:
```bash
mkdir -p /absolute/path/to/data-dir
```

Find your NVM binary path:
```bash
which actual-mcp-server   # after: npm install -g actual-mcp-server
# example output: /home/YOUR_USER/.nvm/versions/node/v22.22.2/bin/actual-mcp-server
```

**Edit `~/.codex/config.toml`** (global) or `.codex/config.toml` (project-scoped, trusted projects only):

```toml
[mcp_servers.actual-budget]
command = "/home/YOUR_USER/.nvm/versions/node/v22.22.2/bin/actual-mcp-server"
args = ["--stdio"]
startup_timeout_sec = 30

[mcp_servers.actual-budget.env]
ACTUAL_SERVER_URL = "http://localhost:5006"
ACTUAL_PASSWORD = "your_actual_password"
ACTUAL_BUDGET_SYNC_ID = "your-sync-id"
MCP_BRIDGE_DATA_DIR = "/absolute/path/to/data-dir"
```

> No `type` field is needed — Codex infers stdio from the presence of `command`.

> `startup_timeout_sec = 30` gives the server enough time to initialise on first run.

**Alternative via CLI** (also needs the absolute path for the same reason):

```bash
codex mcp add actual-budget \
  --env ACTUAL_SERVER_URL=http://localhost:5006 \
  --env ACTUAL_PASSWORD=your_actual_password \
  --env ACTUAL_BUDGET_SYNC_ID=your-sync-id \
  --env MCP_BRIDGE_DATA_DIR=/absolute/path/to/data-dir \
  -- /home/YOUR_USER/.nvm/versions/node/v22.22.2/bin/actual-mcp-server --stdio
```

**If you don't use NVM** (system Node ≥ 20): bare `npx -y actual-mcp-server --stdio` will work fine as the command.

---

## No special ignore file needed

There is no `.mcpignore`, `.cursorignore`, or similar file in the MCP ecosystem. The only file you need to watch for is the **data directory** (`actual-data/` or whatever you set `MCP_BRIDGE_DATA_DIR` to). This directory is already in `.gitignore` — it contains a local SQLite copy of your budget data downloaded by the `@actual-app/api` library, and should never be committed to version control.

If you set `MCP_BRIDGE_DATA_DIR` to a path outside the repo, nothing else changes — it simply won't be gitignored automatically, so ensure that path is not tracked elsewhere.

---

## Troubleshooting

### Where to find server logs

| Client | Log location |
|--------|-------------|
| Claude Desktop (macOS) | Developer → Open MCP Log File |
| Claude Desktop (Linux) | `~/.config/Claude/logs/mcp-server-actual-budget.log` |
| Cursor | View → Output → MCP: actual-budget |
| VS Code | Output panel → MCP: actual-budget |
| Gemini CLI | stderr output in terminal |
| Claude Code | `claude mcp logs actual-budget` |
| OpenAI Codex | stderr output in terminal |

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ReferenceError: File is not defined` + `Node.js v18.x` | Node version too old — requires v20+ | Use absolute NVM path for `command` |
| `URL must use HTTPS` (mcp-remote) | `--allow-http` missing | Add `"--allow-http"` to args (HTTP option) |
| `URL must start with 'https'` (Claude Desktop) | Claude Desktop enforces HTTPS | Switch to HTTPS option or use stdio (Option A) |
| `SSL certificate problem` | Wrong cert path in `NODE_EXTRA_CA_CERTS` | Verify: `ls -la /path/to/cert.pem` |
| `ECONNREFUSED` | Docker container not running | `docker ps \| grep actual-mcp` — start if missing |
| Server starts but no tools appear | Config file not reloaded | Fully restart the AI client after editing config |
| `ACTUAL_PASSWORD` not picked up | Relative env var path | Check variable expansion syntax for your client |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set it to an absolute path in the `env` block |
| `ENOENT` or permission error on startup | Data directory doesn't exist | `mkdir -p /your/data-dir` then restart the client |
| Codex: `connection closed: initialize response` | Codex doesn't load NVM — bare `npx` uses system Node < 20 | Use absolute NVM path: `/home/USER/.nvm/versions/node/vX.Y.Z/bin/actual-mcp-server` |

### JSON config validation

All config files are JSON — a missing comma or bracket silently prevents the server from loading. Validate with:

```bash
python3 -m json.tool /path/to/your/config.json
```

Or use [jsonlint.com](https://jsonlint.com/) in a browser.

### "Actual Budget not found" or sync errors

- Verify your `ACTUAL_SERVER_URL` is reachable: `curl http://localhost:5006`
- Check that the Sync ID matches exactly (Settings → Show Advanced Settings → Sync ID)
- Make sure your Actual Budget server is running

---

## Next steps

- **[62 available tools](../../README.md#available-tools)** — complete list of what your AI can do with your budget
- **[AI Client Setup Guide](AI_CLIENT_SETUP.md)** — LibreChat, LobeChat, Docker networking, HTTPS/TLS proxy, OIDC multi-user
- **[Deployment Guide](DEPLOYMENT.md)** — Docker Compose profiles, production config

---

*Part of the [Actual MCP Server](https://github.com/agigante80/actual-mcp-server) project.*
