Run the ticket readiness gate on a GitHub issue.

## Usage

Accepted argument: `<issue-number>` (required)

Example: `/gate-ticket 42`

## Steps

Use the Agent tool with `subagent_type: ticket-gate`, passing the issue number as the prompt.

The ticket-gate agent handles all steps:
1. Template version check — auto-synthesises missing sections if version is outdated (no BLOCK)
2. Label validation — requires at least one area label (`api`, `backend`, `infrastructure`, `security`, `testing`, `docs`)
3. Fetches the issue from agigante80/actual-mcp-server
4. Reads project context (CLAUDE.md, actual-adapter.ts, toolFactory.ts, schemas/common.ts)
5. Selects dynamic agents based on labels and content (security-auditor, architect-review)
6. Runs 4 core agents + dynamic agents sequentially
7. Compiles and posts the scorecard as a GitHub comment
8. Returns PASS or BLOCKED with specific required changes

All agents must score 10/10 for the ticket to be considered implementation-ready.
