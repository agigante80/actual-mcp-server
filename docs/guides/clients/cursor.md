# Cursor

Cursor runs the server over stdio. It reads MCP configuration from `.cursor/mcp.json` in the project root, or `~/.cursor/mcp.json` for every project, and expands `${env:NAME}` references from the environment Cursor was started in. Example file: [examples/cursor-mcp.json](examples/cursor-mcp.json).

## Prerequisites

- Your Actual Budget server URL, password and Sync ID ([credentials](README.md#your-actual-budget-credentials)).
- Node.js 22 or later and an absolute, user-only data directory ([stdio prerequisites](README.md#prerequisites-for-stdio-clients)).
- `ACTUAL_PASSWORD` in your environment, loaded from the user-only file `~/.config/actual-mcp/env` ([how](README.md#keep-secrets-in-a-user-only-env-file)). Start Cursor from a shell that has it.

## Configure

The file holds only the `${env:ACTUAL_PASSWORD}` reference, so a project `.cursor/mcp.json` is safe to commit:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "${env:ACTUAL_PASSWORD}",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

No install link is offered, and this page documents stdio only. Cursor's documentation describes `${env:NAME}` in `mcp.json`, but a version that resolves it inside the HEADERS of a remote server (rather than sending the text literally) could not be tested for this page, so neither a deeplink nor an HTTP header recipe ships. Copy the block above instead.

Cursor starts the server when a project with this config opens and stops it on close.

**Linux with NVM:** Cursor may not load your shell profile. If `npx` resolves to a system Node older than 22, use the absolute NVM path for `command` (for example `/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/npx`).

## Verify

Open the MCP settings and check that `actual-budget` shows as connected, then ask `List my Actual Budget accounts and their balances.` in the chat. More first questions are in the [shared verify step](README.md#verify).

## Troubleshooting

Logs: **View, Output, MCP: actual-budget**.

| Symptom | Cause | Fix |
|---------|-------|-----|
| The server fails to authenticate to Actual | `ACTUAL_PASSWORD` is not in the environment Cursor started from | Source `~/.config/actual-mcp/env` and start Cursor from that shell |
| `ReferenceError: File is not defined` and `Node.js v18.x` | Node is older than 22 | Use the absolute NVM path for `command` |
| Server starts but no tools appear | The config was not reloaded | Fully restart Cursor |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set an absolute path |
| `ENOENT` or a permission error at startup | The data directory does not exist | Create it, then restart |

Client-independent symptoms are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In your environment only, loaded from `~/.config/actual-mcp/env` (mode 600, outside any repository). `mcp.json` holds the reference `${env:ACTUAL_PASSWORD}`, never the value. Never commit the env file or paste it into an issue.
