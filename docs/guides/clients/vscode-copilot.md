# VS Code (GitHub Copilot)

VS Code runs the server over stdio for Copilot's agent mode. It reads MCP configuration from `.vscode/mcp.json` in the workspace (or the user-level `mcp.json` from the **MCP: Open User Configuration** command). The root key is `servers`, and an `inputs` entry with `"password": true` prompts for the password once and stores it in VS Code's secret storage. Example file: [examples/vscode-mcp.json](examples/vscode-mcp.json).

## Prerequisites

- Your Actual Budget server URL, password and Sync ID ([credentials](README.md#your-actual-budget-credentials)).
- Node.js 22 or later and an absolute, user-only data directory ([stdio prerequisites](README.md#prerequisites-for-stdio-clients)).
- VS Code with GitHub Copilot, agent mode enabled.

## Configure

The file holds only the `${input:actual-password}` reference, so `.vscode/mcp.json` is safe to commit and share with your team:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "actual-password",
      "description": "Actual Budget server password",
      "password": true
    }
  ],
  "servers": {
    "actual-budget": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "${input:actual-password}",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

No install link is offered. VS Code's documentation covers `inputs` with `"password": true` in `mcp.json`, but not an install link that carries an `inputs` array, so a link could not be confirmed to keep the password out of the URL. Copy the block above instead.

**Linux with NVM:** VS Code may not load your shell profile, so `npx` can resolve to a system Node older than 22. Use the absolute path instead, found with `which actual-mcp-server` after `npm install -g actual-mcp-server`: set `"command"` to `"/home/YOUR_USER/.nvm/versions/node/vX.Y.Z/bin/actual-mcp-server"` and `"args"` to `["--stdio"]`.

## Verify

Start the server from the **MCP: List Servers** command (VS Code asks for the password the first time), then ask `List my Actual Budget accounts and their balances.` in Copilot's agent mode. More first questions are in the [shared verify step](README.md#verify).

## Troubleshooting

Logs: run **MCP: List Servers**, pick `actual-budget`, and choose the show-output action (the **Output panel, MCP: actual-budget** channel).

| Symptom | Cause | Fix |
|---------|-------|-----|
| The server fails to authenticate to Actual | A wrong password was stored at the prompt | VS Code stores the value after the first prompt; clear it as described in VS Code's [Manage MCP servers](https://code.visualstudio.com/docs/agents/run/manage-mcp-servers), then restart the server from **MCP: List Servers** |
| `ReferenceError: File is not defined` and `Node.js v18.x` | Node is older than 22 | Use the absolute NVM path for `command` |
| Server starts but no tools appear | Agent mode is off, or the config was not reloaded | Enable agent mode and restart the server |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set an absolute path |

Client-independent symptoms are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In VS Code's secret storage. The password is typed once at the prompt; `.vscode/mcp.json` holds only `${input:actual-password}`. The committed file never holds a literal secret: if you need an env file instead (`envFile`), add it to `.gitignore` before you create it.
