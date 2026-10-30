# Claude Code

Claude Code runs the server over stdio, or connects to a running HTTP server. Its config expands `${VAR}` references in `command`, `args`, `env`, `url` and `headers`, so no secret has to be stored. Example file: [examples/claude-code-mcp.json](examples/claude-code-mcp.json).

## Prerequisites

- Your Actual Budget server URL, password and Sync ID ([credentials](README.md#your-actual-budget-credentials)).
- stdio: Node.js 22 or later and an absolute, user-only data directory ([stdio prerequisites](README.md#prerequisites-for-stdio-clients)).
- HTTP: the server running ([Run the server over HTTP](README.md#run-the-server-over-http)) and its bearer token.
- The secrets in your environment, loaded from the user-only file `~/.config/actual-mcp/env` ([how](README.md#keep-secrets-in-a-user-only-env-file)).

## Configure

### stdio, project `.mcp.json`

A `.mcp.json` in the project root holds only references, so it is safe to commit and share. Claude Code fills `${ACTUAL_PASSWORD}` from the environment it was started in:

```json
{
  "mcpServers": {
    "actual-budget": {
      "type": "stdio",
      "command": "npx",
      "args": ["actual-mcp-server@latest", "--stdio"],
      "env": {
        "ACTUAL_SERVER_URL": "http://localhost:5006",
        "ACTUAL_PASSWORD": "${ACTUAL_PASSWORD}",
        "ACTUAL_BUDGET_SYNC_ID": "your-sync-id-here",
        "MCP_BRIDGE_DATA_DIR": "/absolute/path/to/data-dir"
      }
    }
  }
}
```

`actual-mcp-server@latest` makes `npx` run the latest published version; drop `@latest` to use the version `npx` has cached. Never write a literal password into `.mcp.json`; a file with a literal value belongs at user scope, never in a repository.

### stdio, user scope from the CLI

The single quotes stop your shell from expanding the reference, so Claude Code stores the text `${ACTUAL_PASSWORD}` and resolves it each time it starts the server:

```bash
claude mcp add --scope user actual-budget \
  --env ACTUAL_SERVER_URL=http://localhost:5006 \
  --env 'ACTUAL_PASSWORD=${ACTUAL_PASSWORD}' \
  --env ACTUAL_BUDGET_SYNC_ID=your-sync-id-here \
  --env MCP_BRIDGE_DATA_DIR=/absolute/path/to/data-dir \
  -- npx actual-mcp-server@latest --stdio
```

### HTTP

Set the token without a history line (a silent prompt; nothing is echoed and nothing lands in the argument list), then add the server with the header single quoted:

```bash
read -rs ACTUAL_MCP_TOKEN && export ACTUAL_MCP_TOKEN
claude mcp add --transport http --scope user actual-budget http://localhost:3600/http \
  --header 'Authorization: Bearer ${ACTUAL_MCP_TOKEN}'
```

The exported variable does not survive a new shell, so keep the token in `~/.config/actual-mcp/env` as well. Never use a `${VAR:-default}` reference with a real token as the default. Plain HTTP is for loopback or a Docker-internal network only, and it does not replace the token.

This recipe was tested with Claude Code 2.1.314 at user scope: the stored config holds the literal `${ACTUAL_MCP_TOKEN}`, and the expanded value is sent on connect.

## Verify

Run `claude mcp list` to confirm the server is registered and connected. Then ask `List my Actual Budget accounts and their balances.` in a new session. More first questions are in the [shared verify step](README.md#verify).

## Troubleshooting

Logs: `claude mcp get actual-budget` shows the connection state, and starting Claude Code with `claude --debug=mcp` prints the MCP connection log, including the server's stderr.

| Symptom | Cause | Fix |
|---------|-------|-----|
| The server fails to authenticate to Actual | `ACTUAL_PASSWORD` is not set in the shell that started Claude Code | Source `~/.config/actual-mcp/env`, then restart Claude Code |
| HTTP 401 | `ACTUAL_MCP_TOKEN` is empty or differs from the server's token | Check `test -n "$ACTUAL_MCP_TOKEN"`, then see [troubleshooting.md](../troubleshooting.md#http-401-unauthorized-invalid-token) |
| `ReferenceError: File is not defined` and `Node.js v18.x` | Node is older than 22 | Use a newer Node, or the absolute NVM path for `command` |
| Data appears to reset between sessions | `MCP_BRIDGE_DATA_DIR` is relative | Set an absolute path |

Client-independent symptoms, including a session lost after a server restart, are in [troubleshooting.md](../troubleshooting.md).

## Where the secret lives

In your environment only, loaded from `~/.config/actual-mcp/env` (mode 600, outside any repository). `.mcp.json` and the user-scope entry in Claude Code's user config file (`.claude.json` in your home directory) hold the references `${ACTUAL_PASSWORD}` and `${ACTUAL_MCP_TOKEN}`, never the values. Never commit the env file or paste it into an issue.
