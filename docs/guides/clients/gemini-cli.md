# Gemini CLI

Gemini CLI runs the server over stdio. It reads MCP configuration from `~/.gemini/settings.json` (user level) or `.gemini/settings.json` (project level), and expands `$VAR` and `${VAR}` references in the `env` block. Example file: [examples/gemini-settings.json](examples/gemini-settings.json).

## Prerequisites

- Your Actual Budget server URL, password and Sync ID ([credentials](README.md#your-actual-budget-credentials)).
- Node.js 22 or later and an absolute, user-only data directory ([stdio prerequisites](README.md#prerequisites-for-stdio-clients)).
- `ACTUAL_PASSWORD` in your environment, loaded from the user-only file `~/.config/actual-mcp/env` ([how](README.md#keep-secrets-in-a-user-only-env-file)). Start Gemini CLI from a shell that has it.

## Configure

The file holds only the `$ACTUAL_PASSWORD` reference, so a project `.gemini/settings.json` is safe to commit:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "npx",
      "args": ["-y", "actual-mcp-server", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "$ACTUAL_PASSWORD",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      },
      "trust": false
    }
  }
}
```

**`trust` stays `false`.** With `false`, Gemini CLI asks before each tool call. Setting it to `true` is an explicit opt-in: Gemini then runs every tool without asking, including writes and deletes on your financial data. Turn it on only if you accept that.

**Recommended:** set `MCP_TOOLSETS=chat` on the server. Gemini works better with a small tool list; see [Reducing the tool surface](../../../README.md#reducing-the-tool-surface).

For Gemini's custom MCP connector (the web app, not this CLI) against a server behind Cloudflare Access for SaaS, see [Cloudflare Access for SaaS and Google Gemini](../authentication.md#cloudflare-access-for-saas-and-google-gemini).

## Verify

Run `/mcp` inside Gemini CLI to see `actual-budget` and its tools, then ask `List my Actual Budget accounts and their balances.` Approve the tool call when asked. More first questions are in the [shared verify step](README.md#verify).

## Troubleshooting

Logs: the server's stderr appears in the terminal running Gemini CLI.

| Symptom | Cause | Fix |
|---------|-------|-----|
| The server fails to authenticate to Actual | `ACTUAL_PASSWORD` is not in the shell that started Gemini CLI | Source `~/.config/actual-mcp/env` and start Gemini CLI again |
| `ReferenceError: File is not defined` and `Node.js v18.x` | Node is older than 22 | Use the absolute NVM path for `command` |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set an absolute path |
| `ENOENT` or a permission error at startup | The data directory does not exist | Create it, then restart |

Client-independent symptoms are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In your environment only, loaded from `~/.config/actual-mcp/env` (mode 600, outside any repository) through your shell profile, never as an `export` line typed in a terminal or written into `.bashrc` itself. `settings.json` holds the reference `$ACTUAL_PASSWORD`, never the value. Never commit the env file or paste it into an issue.
