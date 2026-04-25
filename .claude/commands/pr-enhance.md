---
argument-hint: "[PR number or description]"
---

# Pull Request Enhancement

You are a PR optimization expert for actual-mcp-server. Generate comprehensive PR descriptions that facilitate efficient code reviews for the `develop` branch workflow.

## Context

The user needs to create or improve a pull request. Focus on making PRs that are easy to review, well-documented, and include all necessary context for the actual-mcp-server project.

## Requirements

$ARGUMENTS

## Instructions

### 1. PR Analysis

Gather PR context:

```bash
# Current branch and base
git branch --show-current
git log --oneline develop...HEAD

# Changed files vs develop (not main — this project targets develop)
git diff --name-status develop...HEAD

# Change statistics
git diff --shortstat develop...HEAD

# Commits
git log develop...HEAD --pretty=format:"%h %s" | head -20
```

Categorize changed files:
- `src/tools/*.ts` → tool changes (note which tools added/modified)
- `src/lib/actual-adapter.ts` → critical adapter change (requires extra scrutiny)
- `src/actualToolsManager.ts` → tool registration change
- `tests/**` → test changes
- `docs/**`, `*.md` → documentation
- `docker-compose*.yaml` → Docker/infra
- `package.json`, `tsconfig.json` → config/dependency changes

### 2. Project-specific checks

Before writing the description, run the pre-merge validation sequence:

```bash
npm run build 2>&1 | tail -3
npm run verify-tools 2>&1 | tail -3
npm run test:unit-js 2>&1 | tail -5
npm audit --audit-level=moderate 2>&1 | tail -3
```

Note any failures prominently in the PR description.

### 3. PR Description

Generate a PR description using this template:

```markdown
## Summary

[1-3 bullet points describing what this PR does and why]

## Changes

### Tools affected
[List tools added/modified, or "None — infrastructure change"]

### Files changed
- `src/tools/...` — [what changed]
- `tests/...` — [what tests added/updated]
- [other significant files]

## Type of change
- [ ] New MCP tool (requires: verify-tools count update, E2E test, docs sync)
- [ ] Bug fix (existing tool behaviour corrected)
- [ ] Enhancement (existing tool improved)
- [ ] Infrastructure / dependency update
- [ ] Documentation only

## Validation

Pre-merge checklist (run before requesting review):
- [ ] `npm run build` — TypeScript compiles cleanly
- [ ] `npm run verify-tools` — all N tools registered
- [ ] `npm run test:unit-js` — unit + schema tests pass
- [ ] `npm audit --audit-level=moderate` — no new vulnerabilities
- [ ] Amounts in integer cents (not decimal dollars) — verified
- [ ] Date fields as YYYY-MM-DD strings (not Date.now()) — verified
- [ ] withActualApi wraps every Actual API operation — verified

## Breaking changes
[None / describe any breaking changes to MCP tool contracts or env var names]

## Notes for reviewer
[Anything non-obvious: why withActualApi is used a certain way, why a certain approach was chosen, file safety tier of changed files]
```

### 4. Size check

If the PR changes more than 20 files or 500 lines:

```
⚠️ Large PR detected: N files, M lines changed.

Consider splitting by:
- Tool changes vs infrastructure changes (separate PRs)
- New tool vs test additions (can merge tool first, add tests in follow-up)
- Config/dependency update isolated from feature work

Suggested split:
[List logical groupings based on the changed files]
```

### 5. Risk assessment

| Factor | Score | Details |
|--------|-------|---------|
| File safety tier | High/Med/Low | Safe / Caution / Explicit-permission |
| actual-adapter.ts touched | High/Low | affects all 63 tools if yes |
| New tool added | Med/Low | requires docs sync and E2E update |
| Auth/security change | High/Low | OIDC, ACL, Bearer token |
| Dependency change | Med/Low | check npm audit |

Overall risk: Low / Medium / High

### 6. Output

1. Print the generated PR description (ready to paste into GitHub)
2. Print the risk assessment table
3. If the pre-merge validation sequence was run, summarize pass/fail
4. If the PR is large, print the split suggestions

Do not create the PR automatically — output the description for the user to review first.
