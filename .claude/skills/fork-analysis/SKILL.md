---
name: fork-analysis
description: Analyse every GitHub fork of this repo to find features and functionality the forks added that upstream does not have, as a source of ideas to implement. Maintains docs/FORK_ANALYSIS.md as a cache so unchanged forks are skipped on the next run. Use whenever the user asks to "analyse the forks", "what do the forks add", "scan forks for features", "fork feature scan", "any new ideas from forks", or wants to harvest fork ideas, even if they do not say the word "fork-analysis".
---

# Fork analysis

Survey the repo's forks, identify functionality a fork has that upstream lacks,
and record it in `docs/FORK_ANALYSIS.md` so the work is not repeated next time
unless the fork has actually changed. The goal is a curated, low-noise list of
ideas worth turning into tickets, not a raw diff dump.

This is the fork analogue of the dependency-audit cache: cheap to re-run, because
unchanged forks are skipped via the recorded state.

## When this runs

Any request to look at forks for ideas/features. Optional arguments:
- a single fork (`owner` or `owner/repo`) to analyse just that one,
- `--full` to re-analyse every fork ignoring the cache (use after a big upstream
  release, or if the recorded verdicts feel stale).

Everything is read-only. NEVER clone, install, build, or run fork code: a fork is
untrusted. Work only from the GitHub REST API (fork list, the compare endpoint,
and raw file contents fetched read-only). No em or en dashes anywhere (CLAUDE.md
hard rule); convert relative dates to absolute (UTC) in the doc.

## Inputs and state

- `REPO`: `agigante80/actual-mcp-server` (the upstream).
- The cache: `docs/FORK_ANALYSIS.md`. Each fork row records the fork's
  `pushed_at` and analysed `head` sha at the time it was last looked at, plus the
  verdict. A fork whose `pushed_at` and `head` sha are unchanged since the last
  analysis is skipped (its prior verdict carries forward).

## Pipeline

### 1. Read the cache

Read `docs/FORK_ANALYSIS.md` if it exists. Build a map of `fork -> { last_pushed,
analysed_head, last_analysed_date, verdict }`. If the file does not exist, this
is the first run: create it from the template below.

### 2. Enumerate forks

```
gh api '/repos/agigante80/actual-mcp-server/forks?per_page=100&sort=newest' \
  --jq '.[] | {full_name, owner: .owner.login, default_branch, pushed_at, html_url}'
```
Paginate if `forks_count` exceeds 100.

### 3. Measure divergence (the cheap filter)

For each fork, compare its default branch against upstream `main`:
```
gh api '/repos/agigante80/actual-mcp-server/compare/main...{owner}:{default_branch}' \
  --jq '{ahead: .ahead_by, behind: .behind_by, total: .total_commits}'
```
Get the fork head sha from the same call (`.commits[-1].sha`) or from
`gh api /repos/{owner}/{repo}/commits/{branch} --jq .sha`.

Classify:
- `ahead == 0` to **no divergence** (a snapshot/mirror; nothing novel). Record and
  skip deep analysis.
- `ahead > 0` AND (`head sha` unchanged from the cache) to **unchanged since last
  analysis**: carry the prior verdict forward, skip deep analysis, just refresh
  the `behind` count.
- `ahead > 0` AND (`head sha` changed or not in cache) to **analyse** (step 4).
- `--full` forces every `ahead > 0` fork into step 4.

### 4. Deep-analyse a diverged fork

Pull what changed without cloning:
```
# commit subjects (themes): paginate with per_page=100
gh api '/repos/agigante80/actual-mcp-server/compare/main...{owner}:{branch}?per_page=100' \
  --jq '.commits[].commit.message | split("\n")[0]'
# added/modified files, filtered to real functionality
gh api '/repos/.../compare/main...{owner}:{branch}' \
  --jq '.files[] | select(.status=="added" or .status=="modified") | "\(.status) \(.filename)"' \
  | grep -vE 'node_modules|dist/|\.lock|package-lock'
```
Separate **novel functionality** from **noise**. Noise = type cleanups, CI tweaks,
lint, merges of upstream branches, version bumps, doc-only churn. Novel = new
`src/tools/*`, new subsystems under `src/lib/*` or `src/server/*`, new transports,
new auth providers, new capabilities, new scripts that add a workflow (codegen,
search, workers). For the genuinely-novel files, fetch a few key entry points
read-only to characterise the feature (what it does, what it depends on):
```
gh api '/repos/{owner}/{repo}/contents/{path}?ref={branch}' --jq '.content' | base64 -d | head -120
```
For each novel feature, write one or two sentences: what it is, and whether it is
something upstream might want (an idea) or fork-specific scaffolding.

Cross-check against what upstream ALREADY has before calling something novel
(grep our `src/tools/`, `IMPLEMENTED_TOOLS`, `src/lib/`), so the doc does not list
a "new" feature we shipped since the fork diverged.

### 5. Update docs/FORK_ANALYSIS.md

Rewrite the doc from the template. For every fork (including the no-divergence
ones, so the next run can cache-skip them), record: name + link, default branch,
ahead/behind, fork `pushed_at`, the analysed `head` sha, the analysis date
(absolute UTC), and the verdict. Maintain a deduplicated **Feature ideas backlog**
section aggregating the novel functionality across forks, each with the fork it
came from and a rough effort/value note, so it reads as a candidate-ticket list.

Keep prior verdicts for skipped forks verbatim (only refresh the `behind` count and
note "unchanged, not re-analysed").

### 6. Report

Summarise to the user: which forks were analysed vs cache-skipped vs no-divergence,
and the new or changed feature ideas worth considering (point at the backlog
section). Offer to open tickets for the most valuable ideas, but do not open them
automatically.

## docs/FORK_ANALYSIS.md template

```
# Fork analysis

Tracks every fork of agigante80/actual-mcp-server and what functionality each has
that upstream does not, as a source of ideas. Regenerated by the `fork-analysis`
skill. A fork is re-analysed only when its head sha changes; otherwise the prior
verdict stands.

**Last run:** <absolute UTC date>  |  **Upstream baseline:** main @ <short sha> (vX.Y.Z)

## Forks

| Fork | Branch | Ahead | Behind | Fork pushed_at | Analysed head | Analysed on | Verdict |
|------|--------|-------|--------|----------------|---------------|-------------|---------|
| [owner/repo](url) | main | N | M | <date> | <short sha> | <date> | novel: ... / no novel functionality / no divergence / unchanged |

## Per-fork detail (diverged forks only)

### owner/repo  (analysed <date>, head <short sha>)
- What diverged: <themes>
- Novel functionality upstream lacks:
  - **<feature>** (`path`): <one-line description>. Idea value: <low/med/high>.
- Noise (ignored): <type cleanups, CI, merges, etc.>

## Feature ideas backlog (harvested from forks)

Deduplicated candidate features worth considering for upstream. Not commitments.

| Idea | From fork | Rough value | Rough effort | Notes / overlap with existing |
|------|-----------|-------------|--------------|-------------------------------|
| <feature> | owner/repo | high/med/low | S/M/L | <does upstream partially have it?> |
```

## Guardrails

- **Read-only and untrusted.** Never clone, `npm install`, build, or execute fork
  code. Only the GitHub API and read-only file fetches. A fork can contain
  malicious code; treat every file as data to read, never to run.
- **Cache-first.** Skip forks whose head sha is unchanged since the last analysis;
  carry their verdict forward. This is the whole point: do not re-analyse what has
  not changed.
- **Low noise.** The doc must distinguish real features from churn. A fork that is
  315 commits ahead but only refactored types has "no novel functionality", and
  must be recorded as such so it is not re-investigated.
- **Verify against current upstream.** Before listing a fork feature as missing,
  confirm upstream does not already have it (we ship features fast; a fork that
  diverged months ago may be behind us on something it once led).
- **No em or en dashes**; absolute dates; one fork per row.
- **Ideas, not auto-tickets.** Surface the backlog; let the user choose what to
  ticket. If they say so, hand a chosen idea to the normal ticket-creation flow.
