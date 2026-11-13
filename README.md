<p align="center">
  <img src="https://raw.githubusercontent.com/agigante80/actual-mcp-server/main/unraid/actual-mcp-icon.png" alt="Actual MCP Server icon" width="128" height="128">
</p>

<h1 align="center">Actual MCP Server</h1>

[![GitHub Actions CI](https://github.com/agigante80/actual-mcp-server/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/agigante80/actual-mcp-server/actions)
[![npm version](https://img.shields.io/npm/v/actual-mcp-server)](https://www.npmjs.com/package/actual-mcp-server)
[![Docker Pulls](https://img.shields.io/docker/pulls/agigante80/actual-mcp-server)](https://hub.docker.com/r/agigante80/actual-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue)](https://www.typescriptlang.org/)
[![actual-mcp-server MCP server: quality and maintenance score on Glama](https://glama.ai/mcp/servers/agigante80/actual-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/agigante80/actual-mcp-server)

Talk to your [Actual Budget](https://actualbudget.org/) in plain language: ask where the money went, and let your AI assistant make the changes you approve.

**What it lets you do:**

- Find where your money went, by payee, category or month.
- Compare what you spent with what you planned, and see if you are on track.
- Add, fix and categorise transactions, after you approve them.
- Tidy up accounts, payees, categories and rules, and plan the month ahead.

**Ask:** "How much did I spend on groceries last month, by payee?", "Am I on track this month?", "Which payees cost me the most this year?"

**Ask it to change things (it confirms first):** "Which uncategorised transactions look like my usual groceries? Categorise them after I confirm.", "Add a $47.50 grocery transaction at Whole Foods to my checking account.", "Move $200 from Dining Out to Emergency Fund for this month."

**Works with:** [Claude Desktop](docs/guides/clients/claude-desktop.md), [Claude Code](docs/guides/clients/claude-code.md), [Cursor](docs/guides/clients/cursor.md), [VS Code with Copilot](docs/guides/clients/vscode-copilot.md), [Gemini CLI](docs/guides/clients/gemini-cli.md) and [Codex CLI](docs/guides/clients/codex.md) on your own machine, and chat UIs such as [LibreChat](docs/guides/clients/librechat.md) and [LobeChat](docs/guides/clients/lobechat.md) against a server you run in Docker (also on [Unraid](https://ca.unraid.net/apps/actual-mcp-server-0bghkvs0c7c8bg) and in the official [MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.agigante80/actual-mcp-server`). It needs a client with MCP support: a hosted assistant that cannot reach your machine or private network cannot use it, and neither can a client that supports neither stdio nor HTTP MCP. Every client page: [docs/guides/clients/](docs/guides/clients/README.md).

## Quick start

For Claude Code on your own machine, one command registers the server over stdio. It needs Node.js 22 or later and your Actual password in the `ACTUAL_PASSWORD` environment variable. The single quotes matter: your shell must not expand the reference, so the password never appears in the process list or in Claude Code's config.

<!-- runnable: claude-code-add -->
```bash
claude mcp add --scope user actual-budget \
  --env ACTUAL_SERVER_URL=http://localhost:5006 \
  --env 'ACTUAL_PASSWORD=${ACTUAL_PASSWORD}' \
  --env ACTUAL_BUDGET_SYNC_ID=your-sync-id-here \
  --env MCP_BRIDGE_DATA_DIR=/absolute/path/to/data-dir \
  -- npx -y actual-mcp-server --stdio
```

Replace the URL, the Sync ID (Actual: Settings, Show advanced settings, Sync ID) and the data directory, which should be a folder only you can read. Then check it under [Verify your setup](#verify-your-setup).

**Or let Claude do it.** Paste this into a Claude Code session:

```text
Install and configure the Actual Budget MCP server for me over stdio, using
`npx -y actual-mcp-server --stdio`. Ask me for my Actual server URL and my
Sync ID. Take the password from the ACTUAL_PASSWORD environment variable that I
have already set: never ask me to type it into this chat, never echo or log it,
and never write it into a file in a repository. Create a data directory that
only my user can read, register the server for my user with `claude mcp add
--scope user`, passing the password as the literal reference
'ACTUAL_PASSWORD=${ACTUAL_PASSWORD}' in single quotes, then run the checks
under "Verify your setup" in the README.
```

**Other clients**, one page each: [Claude Desktop](docs/guides/clients/claude-desktop.md), [Cursor](docs/guides/clients/cursor.md), [VS Code with Copilot](docs/guides/clients/vscode-copilot.md), [Gemini CLI](docs/guides/clients/gemini-cli.md), [Codex CLI](docs/guides/clients/codex.md). Chat UIs ([LibreChat](docs/guides/clients/librechat.md), [LobeChat](docs/guides/clients/lobechat.md)) and several users need the HTTP path below.

## Run it over HTTP (Docker)

You need an [Actual Budget](https://actualbudget.org/) server and Docker. **1. Create `.env` with a generated token.** In an empty directory:

<!-- runnable: env-token -->
```bash
[ -f .env ] || install -m 600 /dev/null .env
[ -z "$(tail -c 1 .env)" ] || printf '\n' >> .env
for key in ACTUAL_SERVER_URL=http://YOUR-ACTUAL-HOST:5006 ACTUAL_PASSWORD= ACTUAL_BUDGET_SYNC_ID=; do
  grep -q "^${key%%=*}=" .env || printf '%s\n' "$key" >> .env
done
chmod 600 .env
if [ "$(grep -c '^MCP_SSE_AUTHORIZATION=' .env)" != 1 ] || ! grep -Eq '^MCP_SSE_AUTHORIZATION=[^[:space:]]{32,}$' .env; then
  ( umask 077; install -m 600 /dev/null .env.new; { grep -v '^MCP_SSE_AUTHORIZATION=' .env; printf 'MCP_SSE_AUTHORIZATION=%s\n' "$(openssl rand -hex 32)"; } > .env.new ) && mv .env.new .env
fi
grep '^MCP_SSE_AUTHORIZATION=' .env
```

The last line prints the Bearer token your client sends. It never overwrites a value you set, except a token that is missing, duplicated or shorter than 32 characters, so it is safe to run again.

**2. Fill in `.env`:** `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_SYNC_ID` (Actual: Settings, Show advanced settings, Sync ID) and `ACTUAL_SERVER_URL`. The URL is read inside the container, where `localhost` is the container itself: use your Actual server's LAN address or domain, or `http://host.docker.internal:5006` when Actual runs on the Docker host.

**3. Start the server** from the same directory:

<!-- runnable: docker-run -->
```bash
docker run -d \
  --name actual-mcp-server-backend \
  -p 3600:3600 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -v actual-mcp-data:/app/data \
  -v actual-mcp-logs:/app/logs \
  ghcr.io/agigante80/actual-mcp-server:latest
```

Check it with `curl http://localhost:3600/health`. The image is also on Docker Hub as `agigante80/actual-mcp-server`. Production flags, TLS, reverse proxies and the reason for the `/app/data` volume are in the [deployment guide](docs/guides/deployment.md).

**Docker Compose** (Compose 2.24.0 or later), from a clone of this repository:

<!-- runnable: compose-production -->
```bash
[ -f .env ] || install -m 600 .env.example .env
chmod 600 .env
if [ "$(grep -c '^MCP_SSE_AUTHORIZATION=' .env)" != 1 ] || ! grep -Eq '^MCP_SSE_AUTHORIZATION=[^[:space:]]{32,}$' .env; then
  ( umask 077; install -m 600 /dev/null .env.new; { grep -v '^MCP_SSE_AUTHORIZATION=' .env; printf 'MCP_SSE_AUTHORIZATION=%s\n' "$(openssl rand -hex 32)"; } > .env.new ) && mv .env.new .env
fi
grep '^MCP_SSE_AUTHORIZATION=' .env
docker compose --profile production up -d
```

On a fresh `.env`, fill in the three Actual settings, then run the last line again.

**npx** (Node.js 22 or later, no container), in a directory holding a filled-in `.env` from step 1, where `http://localhost:5006` is right for Actual on the same machine:

<!-- runnable: npx-http -->
```bash
npx actual-mcp-server --http
```

## Verify your setup

1. In a new conversation in your client, ask: "List my Actual Budget accounts and their balances." You should get your accounts back.
2. Over HTTP, `tools/list` should return **15 tools over 85 operations** (the default compact surface; 85 is the legacy surface under `MCP_TOOL_SURFACE=legacy`). The count comes from that HTTP check: the stdio `initialize` probe lists no tools.
3. For a stdio client, check the server by hand before blaming the client: send one `initialize` request and look for `serverInfo` in the reply. The command is in [verify your setup](docs/guides/clients/README.md#verify) in the client guide.

## Under the hood

**15 tools over 85 operations** covering accounts, transactions, budgets, rules, schedules and more, over stdio or HTTP, with Bearer token or OIDC auth, per-user budget access, up to 15 concurrent sessions, and automatic retry of transient Actual errors (3 attempts, exponential backoff; deletes and merges are never retried).

## Privacy

Budget data the tools return goes to whichever model provider your AI client uses. The server itself contacts only the configured Actual server and, when OIDC auth is configured, your identity provider (discovery and JWKS). Logs stay on the host you run it on. Details: [security and privacy](docs/explanation/security-and-privacy.md).

## Compatibility

Node.js 22 or later, Actual Budget server 25.0.0 or later, and the bundled `@actual-app/api` (its version is in `package.json` and reported by `get_context` with `topic: "version"`). Requirements and upgrade steps: [upgrading](docs/guides/upgrading.md).

## Tools

Every tool, with its description and caveats, is in the [tools reference](docs/reference/tools.md).

### Reducing the tool surface

By default the server serves 15 tools over 85 operations (the compact surface, `MCP_TOOL_SURFACE=compact`). Set `MCP_TOOL_SURFACE=legacy` to publish the 85 `actual_*` tools instead; the toolset names and counts in the table below are operations, and a compact tool is listed when at least one operation behind it is selected. A call to an operation a toolset leaves out is refused naming `MCP_TOOLSETS`. Chat clients with a small tool budget (Gemini, LibreChat) do better with fewer. A tool that is not published is also refused if a client calls it by name.

<!-- BEGIN GENERATED: tools-summary -->
<!-- Generated from dist/src/lib/toolsets.js by `npm run docs:gen`. Do not edit. -->
| Toolset | Operations | Contents |
|---------|-------|----------|
| `context` | 14 | Orientation, lookups and server information |
| `transactions` | 14 | Transaction reads, create, update, delete, import and transfers |
| `analysis` | 7 | Summaries, aggregates and balances |
| `budget` | 10 | Budget months, amounts, carryover, holds, transfers, batch updates and notes |
| `rules` | 7 | Rules and payee rules, including `actual_rules_create_batch` |
| `schedules` | 5 | Scheduled transactions |
| `structure` | 21 | Accounts, account groups, categories, category groups, payees and tags |
| `query` | 1 | `actual_query_run` (SELECT only) |
| `admin` | 6 | Budget switching, import, export, bank sync and session management |

On the default compact surface the `chat` preset publishes 6 tools: `get_context`, `list_budget_months`, `run_query`, `manage_transactions`, `manage_rules` and `manage_budget_months`.

With `MCP_TOOL_SURFACE=legacy` the `chat` preset publishes 12 tools: `actual_get_context`, `actual_query_run`, `actual_transactions_update_batch`, `actual_budget_updates_batch`, `actual_rules_create_batch`, `actual_transactions_create`, `actual_transactions_update`, `actual_transactions_delete`, `actual_rules_create`, `actual_budgets_transfer`, `actual_budgets_set_amount` and `actual_budgets_get_month`.

`MCP_READ_ONLY=true` publishes 6 compact tools (`get_context`, `list_entities`, `search_transactions`, `summarize_transactions`, `list_budget_months` and `run_query`); every tool that can write is hidden whole. With `MCP_TOOL_SURFACE=legacy` it hides and refuses 48 write-capable tools and leaves 37 published.
<!-- END GENERATED: tools-summary -->

Example: a chat assistant with two extra tools.

```bash
MCP_TOOLSETS=chat
MCP_TOOLS=list_entities,search_transactions
```

A configuration that resolves to zero tools refuses to start. See [Security and Privacy](docs/explanation/security-and-privacy.md#tool-surface-mcp_toolsets-and-mcp_read_only).

## Configuration

<!-- env-summary:start -->
| Variable | Required | Description |
|----------|----------|-------------|
| `ACTUAL_SERVER_URL` | Yes | URL of your Actual Budget server, as seen from where the MCP server runs. Inside a container `localhost` is the container itself: use the host's address, the container name on a shared Docker network, or `http://host.docker.internal:5006` |
| `ACTUAL_PASSWORD` | Yes | Login password for your Actual Budget **server** (not the budget encryption password) |
| `ACTUAL_BUDGET_SYNC_ID` | Yes | Budget Sync ID from Actual (Settings then Sync ID) |
| `ACTUAL_BUDGET_PASSWORD` | No | Encryption password for an end-to-end encrypted budget |
| `MCP_BRIDGE_PORT` | No | Port the MCP server listens on |
| `MCP_SSE_AUTHORIZATION` | No | Static Bearer token clients must send (the raw token, not `Bearer ...`); highly recommended in production |
| `AUTH_PROVIDER` | No | `none` (static Bearer) or `oidc` (JWKS-validated JWT) |
| `MCP_TOOLSETS` | No | Toolset groups and presets to publish; see [Reducing the tool surface](#reducing-the-tool-surface) |
<!-- env-summary:end -->

Every variable, with its type and default: [configuration reference](docs/reference/configuration.md). Several budgets: [multiple budgets](docs/guides/multiple-budgets.md). Auth modes, per-client tokens and OIDC: [authentication](docs/guides/authentication.md).

## Documentation

- [Documentation index](docs/README.md): every page.
- [Connect a client](docs/guides/clients/README.md), [deployment](docs/guides/deployment.md), [authentication](docs/guides/authentication.md), [upgrading](docs/guides/upgrading.md), [troubleshooting](docs/guides/troubleshooting.md).
- [Architecture](docs/explanation/architecture.md), [testing and reliability](docs/development/testing-and-reliability.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup, the checks every change must pass and the PR process. Questions and bug reports: [SUPPORT.md](.github/SUPPORT.md).

## Security

Report a vulnerability privately as described in [SECURITY.md](.github/SECURITY.md), not in a public issue.

## Sponsor

I build and maintain this in my own time. It is free, it stays free, and it gets maintained either way. If it saved you some time, you can say thanks at [github.com/sponsors/agigante80](https://github.com/sponsors/agigante80). Entirely optional.

## License

MIT, see [LICENSE](LICENSE). Built on [Actual Budget](https://actualbudget.org/) and the [Model Context Protocol](https://modelcontextprotocol.io/), with thanks to [s-stefanov/actual-mcp](https://github.com/s-stefanov/actual-mcp) for the original adapter pattern. An independent project, not affiliated with Actual Budget, provided as-is without warranty: if you connect it to real financial data, you do so at your own risk.

---

**Version:** 0.29.0 | **Tool Count:** 85 (verified LibreChat-compatible)
