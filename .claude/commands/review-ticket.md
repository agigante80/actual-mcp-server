Run the ticket readiness gate on a GitHub issue.

## Usage

Accepted argument: `<issue-number>` (required)

## Steps

Use the Agent tool with `subagent_type: ticket-gate`, passing the issue number as the prompt.

The ticket-gate agent handles all steps:
1. Template version check (blocks if stale or missing)
2. Fetches the issue from GitHub
3. Reads project context (CLAUDE.md, adapter, toolFactory)
4. Runs all 4 agents sequentially (tool-author → qa → release-manager → actual-api)
5. Compiles and posts the scorecard as a GitHub comment
6. Returns PASS or BLOCKED with required changes
