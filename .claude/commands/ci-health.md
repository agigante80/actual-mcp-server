# CI Health Monitor

Check all GitHub Actions workflows for failures, create P0 tickets, gate each ticket, and auto-fix safe failures.

## Process

Execute these phases in order. Stop early if all workflows are passing.

### Phase 1: Discover and assess workflows

Auto-discover all workflow files:

```bash
ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null
```

Detect the working branch (always `develop` for this project — never push fixes directly to `main`):

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "develop"
```

For each discovered workflow, check the latest run on `develop`:

```bash
gh run list --workflow <workflow-file> --branch develop --limit 1 --json databaseId,conclusion,createdAt,name -q '.[0]'
```

For each **failing** run, get failed jobs and error logs:

```bash
gh run view <RUN_ID> --json jobs --jq '.jobs[] | select(.conclusion == "failure") | .name'
gh run view <RUN_ID> --log-failed 2>&1 | tail -150
```

Report a summary table:

| Workflow | Status | Failed jobs |
|---|---|---|
| ci.yml | pass/fail | job1, job2 |

If ALL workflows are passing, report "All workflows green" and stop.

### Phase 2: Create tickets for failures

For each failing job:

1. **Check for an existing open ticket** to avoid duplicates:
```bash
gh issue list --search "fix(ci): <job-name-keyword>" --state open --limit 1
```

2. **If no ticket exists**, create one:
   - Title: `fix(ci): <workflow> - <job-name> failing on develop`
   - Labels: `bug`, `infrastructure`
   - Priority: P0
   - Body must include:
     - Error logs (last 100 lines of failed job)
     - Link to the failing run
     - Affected files (if identifiable from logs)
     - `<!-- template-version: 3 -->` marker
     - Acceptance criteria: "CI job passes on `develop`"
     - `## GDPR compliance\nN/A`

3. **If a ticket already exists**, add a comment with the latest error logs.

### Phase 3: Gate each new ticket

Run the ticket-gate agent on each newly created ticket. Fix and re-run until 10/10.

Use parallel agents if multiple tickets were created.

### Phase 4: Implement fixes

For each gated ticket:

**AUTO-IMPLEMENT** (fix and push to `develop`):
- TypeScript compile errors (`npm run build` failures)
- Tool registration mismatches (`npm run verify-tools` failures)
- Unit test failures (`npm run test:unit-js` failures)
- npm audit moderate+ vulnerabilities (upgrade direct dep first; override only as last resort)
- Build configuration errors
- Lint failures

After implementing, run the full pre-commit validation sequence:
```bash
npm run build
npm run verify-tools
npm run test:unit-js
npm audit --audit-level=moderate
```

Then commit and push:
```bash
git add <specific-files>
git commit -m "fix(ci): <description>"
git push origin develop
```

**DO NOT AUTO-IMPLEMENT** (investigate only, leave a comment):
- E2E test failures — comment: "E2E: investigation complete, manual review required before fix"
- Security scan findings — comment with findings summary, do not auto-fix
- Integration test failures — require live server, leave investigation notes

### Phase 5: Verify

After pushing, wait 30 seconds then check whether a new run was triggered:

```bash
gh run list --workflow <workflow-file> --branch develop --limit 1 --json databaseId,status,conclusion -q '.[0]'
```

Report whether the fix was pushed and a new run is in progress.

---

## Rules

- **Never hard-code workflow file names** — always discover via `ls .github/workflows/`
- **Working branch is `develop`** — never push fixes directly to `main` without explicit user permission
- **Gate review must pass 10/10** before implementing any fix
- **One commit per fix** — not one big commit for everything
- **Pre-commit sequence is mandatory** before every push: `npm run build && npm run verify-tools && npm run test:unit-js && npm audit --audit-level=moderate`
- **No duplicate tickets** — always search before creating
- **npm overrides are last resort** — only for security CVEs with no direct-dep upgrade available
