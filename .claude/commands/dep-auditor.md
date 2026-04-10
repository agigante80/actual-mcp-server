Run a dependency health audit for actual-mcp-server and create GitHub issues for any findings.

## Usage

Accepted arguments: `[--full]`

- Default: skip libraries checked within the last 30 days (cache-first)
- `--full`: ignore the cache and re-audit every library

## Overview

Runs 4 sequential checks, writes results to `docs/audit/dep-audit-cache.json`, and opens GitHub issues for every finding. Never auto-removes or auto-updates anything — create tickets only.

---

## Step 1 — Read the cache

Read `docs/audit/dep-audit-cache.json` if it exists. Structure:

```json
{
  "lastFullAudit": "<ISO timestamp>",
  "libraries": {
    "<package-name>": {
      "lastChecked": "<YYYY-MM-DD>",
      "status": "maintained|unmaintained|deprecated",
      "lastPublish": "<YYYY-MM-DD>",
      "weeklyDownloads": 0
    }
  }
}
```

If the file does not exist, treat all libraries as uncached. If `--full` was passed, treat all libraries as uncached regardless.

---

## Step 2 — Check 1: Unused dependencies (Knip)

Run:
```bash
npx knip --no-exit-code 2>&1
```

**Known false positives — exclude from tickets:**
- `tsconfig-paths` — used by `scripts/register-tsconfig-paths.js` at runtime
- `dotenv` — loaded dynamically via `src/index.ts`
- `@types/*` packages — compile-time only, not detectable by Knip
- `@playwright/test` — test-only, conditionally executed

For any remaining unused dependencies or exports flagged by Knip, prepare one ticket:

> **Title:** `fix: remove unused dependencies (Knip)`
> **Labels:** `infrastructure`
> **Body:** list each flagged item with the file/import path where it appears (or doesn't)

---

## Step 3 — Check 2: npm registry health (unmaintained / low-adoption)

For each direct dependency in `package.json` (both `dependencies` and `devDependencies`), check whether it was already audited within 30 days (skip if so, unless `--full`).

For uncached libraries, fetch metadata:

```bash
npm view <pkg> time --json 2>/dev/null       # last publish date
curl -s "https://api.npmjs.org/downloads/point/last-week/<pkg>"  # weekly downloads
```

Also check deprecated status:
```bash
npm view <pkg> deprecated 2>/dev/null
```

**Classification thresholds:**

| Severity | Condition |
|----------|-----------|
| Critical | Package is deprecated/archived, OR < 1 000 weekly downloads |
| Warning  | > 12 months since last publish, OR < 10 000 weekly downloads |
| Info     | 6–12 months since last publish |

For each Critical or Warning finding, create one ticket per package:

> **Title:** `audit: evaluate <pkg> — unmaintained (<N> months since last publish)`
> **Labels:** `infrastructure`
> **Body must include:**
> - Last publish date and months elapsed
> - Weekly download count
> - Whether deprecated flag is set
> - Functional purpose in this codebase (1–2 sentences)
> - Alternatives research: at least 2 alternatives (competing package, built-in Node/TS feature, or custom impl) with a comparison table: downloads/week · last publish · pros/cons
> - Effort estimate: files that would change, rough complexity (low/medium/high)
> - Risk: breaking change potential, test coverage impact
> - Recommendation: replace / keep / monitor

Update the cache entry for every library checked (whether flagged or not).

---

## Step 4 — Check 3: Known vulnerabilities

Run:
```bash
npm audit --json 2>/dev/null
```

Parse the JSON output. For each vulnerability with severity `moderate`, `high`, or `critical`, create one ticket per vulnerable package:

> **Title:** `security: fix <pkg> — <severity> vulnerability`
> **Labels:** `infrastructure`, `security`
> **Body must include:**
> - CVE / advisory ID and title
> - Severity and CVSS score if available
> - Which direct dependency pulls it in (the dependency path)
> - Recommended fix: upgrade the **direct** dependency that pulls it in — never use `npm overrides` or `pnpm.overrides` to force a transitive version
> - `npm audit fix` command if a non-breaking fix is available

---

## Step 5 — Check 4: Version drift

Run:
```bash
npm outdated --json 2>/dev/null
```

For each package that is **1 or more major versions** behind latest, create one ticket:

> **Title:** `fix: upgrade <pkg> from <current> to <latest>`
> **Labels:** `infrastructure`
> **Body must include:**
> - Current version, wanted version, latest version
> - Link to the package's changelog or releases page
> - Breaking changes summary (fetch from changelog if possible)
> - Which files in `src/` import this package (use Grep)
> - Estimated effort: low (patch/minor) / medium (major, few callsites) / high (major, many callsites)

Also flag packages that are **2+ minor versions** behind as Info-level notes in the report (no ticket required unless they become major drift).

---

## Step 6 — Update the cache

Merge all newly-checked library data into `docs/audit/dep-audit-cache.json`. Set `lastFullAudit` to now if `--full` was passed. Never overwrite entries for libraries that were skipped (still within 30-day window).

Create `docs/audit/` if it does not exist.

---

## Step 7 — Deduplicate and create GitHub issues

Before creating any ticket, search for an existing open issue:
```bash
gh issue list --label infrastructure --state open --search "<pkg>" --json number,title
```

Skip creation if a matching open issue already exists (same package name in title).

For each new ticket, use the template below. This mirrors the `.github/ISSUE_TEMPLATE/infrastructure.yml` form so programmatically-created tickets look identical to manually-filed ones.

```
<!-- dep-auditor: template-version 2 -->

## Summary

<one-sentence summary of the issue>

## Finding type

<one of: Dependency vulnerability (CVE) / Outdated dependency (major version drift) / Unmaintained / deprecated package / Unused dependency (Knip)>

## Area(s) affected

npm dependencies (outdated / vulnerable / unused)

## Priority

<P0 — Critical / P1 — High / P2 — Medium / P3 — Low>
P2 — Medium (dependency health, address within 2 sprints) — default unless severity warrants higher

## Details

<full details per the body requirements above — last publish date, downloads, CVE ID, alternatives, effort, risk, recommendation>

## Security considerations

- **Credentials:** n/a (dependency change only)
- **Access control:** n/a
- **Network exposure:** n/a

## Rollback plan

Revert to previous package version: `npm install <pkg>@<previous-version>`
No data migration needed.

## Acceptance Criteria

- [ ] Issue investigated; decision made (fix / replace / accept risk)
- [ ] If fixing: PR merged and passing CI
- [ ] If accepting risk: decision documented in a comment on this issue
- [ ] `npm audit --audit-level=moderate` passes
```

Assign to the current milestone if one is active:
```bash
gh api repos/{owner}/{repo}/milestones --jq '.[0].title' 2>/dev/null
```

---

## Step 8 — Print summary

After all tickets are created, print a summary table:

```
## Dependency Audit Summary

| Check              | Findings | Tickets created | Tickets skipped (exists) |
|--------------------|----------|-----------------|--------------------------|
| Knip (unused)      | N        | N               | N                        |
| Registry health    | N        | N               | N                        |
| Vulnerabilities    | N        | N               | N                        |
| Version drift      | N        | N               | N                        |

Cache updated: docs/audit/dep-audit-cache.json
Next full re-audit recommended: <date 30 days from now>
```

If there are zero findings across all checks, print:
```
✓ All dependencies are healthy. No tickets created.
```
