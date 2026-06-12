Run a source code-health audit for actual-mcp-server and create GitHub issues for genuine findings.

## Usage

Accepted arguments: `[--full] [--dry-run]`

- Default: cache-first. Skip findings already filed and recorded in the cache.
- `--full`: ignore the cache and re-triage every finding.
- `--dry-run`: print the report and the tickets that WOULD be filed, but create no
  tickets and write no cache. Use this for review.

This auditor is run MANUALLY on demand. It is NOT scheduled: never set up a GitHub Actions
cron or a Claude Code scheduled routine for it. (Scope split: this owns SOURCE dead code and
doc-to-code drift; `/dep-auditor` owns DEPENDENCY health. Do not re-file unused-dependency
findings here.)

## Provenance / canonical source

This skill is the canonical copy. The sibling project `agigante80/Actual-sync#130` adopts the
same `code-health-auditor` shape; if it diverges, reconcile against this copy. Keep
project-specific values (paths, labels) minimal so the two stay alignable.

## Overview

One pass: read the cache, run Knip (dead code) with the committed config, run the drift
guards, triage findings against the documented allowlist, then open gate-ready tickets for
the genuine ones and update the cache. Never auto-remove code or auto-edit docs: file tickets
only. Output uses no em or en dashes.

---

## Step 1 - Read the cache

Read `docs/audit/deadcode-audit-cache.json` if it exists. Schema:

```json
{
  "lastFullAudit": "<ISO timestamp>",
  "findings": {
    "<kind:path:symbol>": {
      "firstSeen": "<YYYY-MM-DD>",
      "lastSeen": "<YYYY-MM-DD>",
      "status": "filed|allowlisted|wontfix",
      "ticket": "<#NNN or null>",
      "notes": "<short reason>"
    }
  }
}
```

The finding key is a stable composite `kind:path:symbol` (e.g.
`unused-export:src/lib/constants.ts:SERVER_INFO`, `unused-file:src/server/streamable-http.ts:`)
so re-runs are idempotent. If the file does not exist, treat all findings as new. If `--full`
was passed, re-triage every finding regardless of cache.

---

## Step 2 - Run Knip (dead code)

```bash
npx knip --no-exit-code
```

This uses the committed `knip.json`. Since #237 the gated `npm run knip` is failing-mode
(exits nonzero on any dead code), so this skill runs `npx knip --no-exit-code` directly to
always capture the full report for triage regardless of exit code. Parse the report into
findings of kind `unused-file`, `unused-export`, `unused-type`, `duplicate-export`.

**Allowlist (do NOT file; these are alive or intentional):**
- Anything tagged `@public` in source (e.g. `DEFAULT_HTTP_PORT`, consumed by the text-parsing
  port_alignment guard, not by an import).
- `src/prompts/**`, `src/resources/**` (intentional unshipped MCP capability scaffolding;
  the server advertises `prompts:false`/`resources:false`). These are `entry` points in
  `knip.json` so Knip already excludes them; if a future Knip change surfaces them, still skip.
- Generated code under `generated/**` (not authored here).

Everything else Knip reports is a GENUINE finding to triage (file unless cached as
`allowlisted`/`wontfix`).

---

## Step 3 - Run the doc-to-code drift guards

```bash
npm run build && npm run test:unit-js 2>&1 | grep -iE "FAIL|drift|mismatch|Results:" || true
```

The committed guards (`tool_count_sync`, `config_drift`, `port_alignment`,
`dockerfile_data_dir_alignment`, `compose_profile_sync`, `advertised_tools_sync`) already fail
CI on the drift they cover. Your job is to surface NEW drift they do NOT yet cover: a doc that
advertises a surface (tool, prompt, resource, endpoint, env var, script) with no implementing
symbol, or a hardcoded number in a doc that no guard enforces. For each, recommend either a
fix or a new committed guard (de-hardcode behind a guard rather than restate the number).

---

## Step 4 - Triage and de-duplicate

For each genuine finding, compute its `kind:path:symbol` key and check the cache and open
issues:

```bash
gh issue list --label infrastructure --state open --search "<symbol or path>" --json number,title
```

Skip findings already cached as `filed` (with a live ticket), `allowlisted`, or `wontfix`,
and skip any with an existing open issue. Group related findings (e.g. all unused
`constants.ts` exports) into ONE ticket where sensible.

---

## Step 5 - Create gate-ready tickets

For each new genuine finding (or group), open an issue with the bug or infrastructure
template body, the `<!-- template-version: 3 -->` marker, an area label (`infrastructure`
and/or the relevant area), and a priority label (`P2` default, `P3` for low-risk cleanup).
Cross-reference #234. Body must state: what is dead/drifted, the evidence (file:line), the
proposed action (remove / wire up / add a guard), positive and negative scenarios, and a
rollback. In `--dry-run`, print the bodies instead of creating issues.

`gh` sandbox note: write the body to a repo-root dot-file (`./.ch-<n>-body.md`) and delete it
after the `gh` call; `/tmp` is not readable from the sandbox.

---

## Step 6 - Update the cache

Merge the triaged findings into `docs/audit/deadcode-audit-cache.json`: set `lastSeen` to
today for every finding seen this run, `firstSeen` on new ones, `status` + `ticket` for filed
ones, and `lastFullAudit` to now if `--full` was passed.

Delete over archiving: when a `filed` finding is no longer present in a SUCCESSFUL Knip report
(the dead code shipped and was removed), DELETE its cache entry. The closed GitHub issue is the
history, so the cache must not accumulate resolved cruft. Keep only: `allowlisted` / `wontfix`
entries (intentional, permanent) and `filed` entries still open. The one exception is a run that
FAILED to produce a valid report (e.g. a build error masked findings): do not delete on a failed
run, since absence then is not proof of resolution. Skip this step entirely in `--dry-run`.

---

## Step 7 - Report

Print a markdown summary: counts by kind, the tickets filed (with numbers) or that would be
filed (dry run), the allowlisted/cached skips, and any NEW doc-to-code drift recommendations.
Stop there. Never remove code, never edit docs, never schedule anything.
