# Documentation

Every page under `docs/` is listed here, grouped by what you came to do. `npm run docs:check` fails when a page is missing from this index; working notes under `docs/plans/` and generated audit output under `docs/audit/` are not listed.

## Guides: get something done

- [guides/clients/README.md](guides/clients/README.md): start here to connect a client: pick a transport, keep secrets out of config files, verify.
  - [guides/clients/claude-desktop.md](guides/clients/claude-desktop.md): Claude Desktop, over stdio or HTTP.
  - [guides/clients/claude-code.md](guides/clients/claude-code.md): Claude Code.
  - [guides/clients/cursor.md](guides/clients/cursor.md): Cursor.
  - [guides/clients/vscode-copilot.md](guides/clients/vscode-copilot.md): VS Code with GitHub Copilot.
  - [guides/clients/gemini-cli.md](guides/clients/gemini-cli.md): Gemini CLI.
  - [guides/clients/codex.md](guides/clients/codex.md): OpenAI Codex CLI.
  - [guides/clients/librechat.md](guides/clients/librechat.md): LibreChat.
  - [guides/clients/lobechat.md](guides/clients/lobechat.md): LobeChat.
- [guides/deployment.md](guides/deployment.md): Docker, Compose profiles, production configuration.
- [guides/authentication.md](guides/authentication.md): choose an HTTP auth mode and see which budgets each one reaches.
- [guides/multiple-budgets.md](guides/multiple-budgets.md): configure several budgets and switch between them.
- [guides/upgrading.md](guides/upgrading.md): upgrade steps, requirements, and changes that can stop a server from starting.
- [guides/troubleshooting.md](guides/troubleshooting.md): common symptoms with their cause and fix.

## Reference: look something up

- [reference/configuration.md](reference/configuration.md): every environment variable, with type, default and source.

## Explanation: understand how it works

- [explanation/architecture.md](explanation/architecture.md): components, transports and data flow.
- [explanation/security-and-privacy.md](explanation/security-and-privacy.md): auth model, threat model and hardening.

## Development: change the project

- [development/new-tool-checklist.md](development/new-tool-checklist.md): add a new MCP tool end to end.
- [development/testing-and-reliability.md](development/testing-and-reliability.md): test layers, the test-file inventory and the release gate.
- [development/ticket-standards.md](development/ticket-standards.md): what a ready work ticket contains.
- [development/unraid-ca-publishing.md](development/unraid-ca-publishing.md): publishing the Unraid Community Applications template.

## Planning

- [roadmap.md](roadmap.md): the project's phases.
