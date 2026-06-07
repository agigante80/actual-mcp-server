---
name: fork-analysis
description: Analyse every GitHub fork of this repo, and every meaningful BRANCH within each fork, to find features and functionality the forks added that upstream does not have, as a source of ideas to implement. Maintains docs/FORK_ANALYSIS.md as a cache so unchanged fork branches are skipped on the next run. Use whenever the user asks to "analyse the forks", "what do the forks add", "scan forks for features", "fork feature scan", "any new ideas from forks", or wants to harvest fork ideas, even if they do not say the word "fork-analysis".
---

# Fork analysis

Survey the repo's forks AND each fork's branches, identify functionality a fork
branch has that upstream lacks, and record it in `docs/FORK_ANALYSIS.md` so the
work is not repeated next time unless that branch has actually changed. The goal
is a curated, low-noise list of ideas worth turning into tickets, not a raw diff
dump.

Branch coverage matters: a fork's default branch (main) may be a stale snapshot
while a feature/fix branch carries the real work (for example a `fix/...` branch
with a bug fix that never reached the fork's own main). The default-branch-only
view misses those, so analyse every meaningful branch.

This is the fork analogue of the dependency-audit cache: cheap to re-run, because
unchanged branches are skipped via the recorded head sha.

## When this runs

Any request to look at forks for ideas/features. Optional arguments:
- a single fork (`owner` or `owner/repo`) to analyse just that one,
- a single `owner:branch` to analyse one branch,
- `--full` to re-analyse every branch ignoring the cache (use after a big upstream
  release, or if the recorded verdicts feel stale).

Everything is read-only. NEVER clone, install, build, or run fork code: a fork (or
a fork branch) is untrusted. Work only from the GitHub REST API (fork list, the
branches endpoint, the compare endpoint, and raw file contents fetched read-only).
No em or en dashes anywhere (CLAUDE.md hard rule); convert relative dates to
absolute (UTC) in the doc.

## Inputs and state

- `REPO`: `agigante80/actual-mcp-server` (the upstream).
- The cache: `docs/FORK_ANALYSIS.md`. Each row is a `(fork, branch)` pair and
  records that branch's `head` sha and `pushed`/analysed date at the time it was
  last looked at, plus the verdict. A `(fork, branch)` whose head sha is unchanged
  since the last analysis is skipped (its prior verdict carries forward). Branches
  that share a head sha (e.g. a feature branch identical to main) are deduplicated.

## Pipeline

### 1. Read the cache

Read `docs/FORK_ANALYSIS.md` if it exists. Build a map of
`(fork, branch) -> { head, last_analysed_date, verdict }`. If the file does not
exist, this is the first run: create it from the template below.

### 2. Enumerate forks and their branches

```
gh api '/repos/agigante80/actual-mcp-server/forks?per_page=100&sort=newest' \
  --jq '.[] | {full_name, owner: .owner.login, default_branch, html_url}'
```
Paginate if `forks_count` exceeds 100. For each fork, list its branches and their
head shas:
```
gh api '/repos/{owner}/{repo}/branches?per_page=100' --jq '.[] | "\(.name) \(.commit.sha[0:7])"'
```

**Branch filter (cut the noise before any compare):**
- SKIP `dependabot/*` branches: automated dependency PRs, never features.
- DEDUPLICATE branches pointing at the same head sha (analyse that sha once; note
  the branch names that share it).
- KEEP everything else: the fork's `main`, `develop`, and any `feat/*`, `fix/*`,
  `deps/*`, `reconcile/*`, custom-named branches, etc. `deps/*` and `reconcile/*`
  are usually dependency bumps or upstream syncs (low novelty) but are cheap to
  screen by ahead-count in step 3, so do not pre-judge them; just let the
  divergence filter drop them if they add nothing.

### 3. Measure divergence per branch (the cheap filter)

For each kept `(fork, branch)`, compare it against upstream `main`:
```
gh api '/repos/agigante80/actual-mcp-server/compare/main...{owner}:{branch}' \
  --jq '{ahead: .ahead_by, behind: .behind_by, total: .total_commits}'
```
The branch head sha comes from step 2.

Classify each `(fork, branch)`:
- `ahead == 0` to **no divergence** (a snapshot/mirror of upstream; nothing novel).
  Record once per fork (do not list every zero-ahead branch separately; a single
  "default + N tracking branches at upstream" note is enough), skip deep analysis.
- `ahead > 0` AND (`head sha` unchanged from the cache) to **unchanged since last
  analysis**: carry the prior verdict forward, skip deep analysis, refresh the
  `behind` count only.
- `ahead > 0` AND (`head sha` changed or not in cache) to **analyse** (step 4).
- `--full` forces every `ahead > 0` branch into step 4.

### 4. Deep-analyse a diverged branch

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
lint, merges of upstream branches, dependency/version bumps, doc-only churn. Novel
= new `src/tools/*`, new subsystems under `src/lib/*` or `src/server/*`, new
transports, new auth providers, new capabilities, a `fix/*` that patches a real
bug, new scripts that add a workflow (codegen, search, workers). For the
genuinely-novel files, fetch a few key entry points read-only to characterise the
feature (what it does, what it depends on):
```
gh api '/repos/{owner}/{repo}/contents/{path}?ref={branch}' --jq '.content' | base64 -d | head -120
```
For each novel item, write one or two sentences: what it is, and whether it is
something upstream might want (an idea) or fork-specific scaffolding.

Cross-check against what upstream ALREADY has before calling something novel
(grep our `src/tools/`, `IMPLEMENTED_TOOLS`, `src/lib/`, recent CHANGELOG/issues),
so the doc does not list a "new" feature or fix we shipped since the branch
diverged.

A branch that is ahead but only contains noise (a dependabot-style bump, an
upstream reconcile, a pure type refactor) gets verdict "no novel functionality"
and is recorded as such, so it is not re-investigated.

### 5. Update docs/FORK_ANALYSIS.md

Rewrite the doc from the template. For every analysed or skipped `(fork, branch)`
that has divergence, record a row: fork + link, branch, ahead/behind, head sha,
analysis date (absolute UTC), and the verdict. Roll the zero-ahead branches of a
fork into a single "no divergence" line for that fork so the table stays readable.
Maintain a deduplicated **Feature ideas backlog** section aggregating the novel
functionality across all fork branches, each tagged with `fork:branch` and a rough
effort/value note, so it reads as a candidate-ticket list.

Keep prior verdicts for skipped branches verbatim (only refresh the `behind`
count and note "unchanged, not re-analysed").

### 6. Report

Summarise to the user: how many fork branches were analysed vs cache-skipped vs
no-divergence, and the new or changed feature ideas worth considering (point at
the backlog section). Offer to open tickets for the most valuable ideas, but do
not open them automatically.

## docs/FORK_ANALYSIS.md template

```
# Fork analysis

Tracks every fork of agigante80/actual-mcp-server, and each meaningful branch
within a fork, plus what functionality each has that upstream does not, as a
source of ideas. Regenerated by the `fork-analysis` skill. A branch is
re-analysed only when its head sha changes; otherwise the prior verdict stands.

**Last run:** <absolute UTC date>  |  **Upstream baseline:** main @ <short sha> (vX.Y.Z)

## Fork branches

| Fork | Branch | Ahead | Behind | Head | Analysed on | Verdict |
|------|--------|------:|------:|------|-------------|---------|
| [owner/repo](url) | fix/foo | N | M | <short sha> | <date> | novel: ... / no novel functionality / unchanged |
| [owner/repo](url) | (main + N tracking branches) | 0 | M | <short sha> | <date> | no divergence |

(dependabot/* branches are excluded as automated-dependency noise.)

## Per-branch detail (diverged branches with novel content)

### owner/repo : <branch>  (analysed <date>, head <short sha>)
- What diverged: <themes>
- Novel functionality upstream lacks:
  - **<feature>** (`path`): <one-line description>. Idea value: <low/med/high>.
- Noise (ignored): <type cleanups, CI, dep bumps, merges, etc.>

## Feature ideas backlog (harvested from fork branches)

Deduplicated candidate features worth considering for upstream. Not commitments.

| Idea | From | Rough value | Rough effort | Notes / overlap with existing |
|------|------|-------------|--------------|-------------------------------|
| <feature> | owner/repo:branch | high/med/low | S/M/L | <does upstream partially have it?> |
```

## Guardrails

- **Read-only and untrusted.** Never clone, `npm install`, build, or execute fork
  code from any branch. Only the GitHub API and read-only file fetches. A fork
  branch can contain malicious code; treat every file as data to read, never to run.
- **Cache-first, per branch.** Skip `(fork, branch)` pairs whose head sha is
  unchanged since the last analysis; carry their verdict forward. This is the whole
  point: do not re-analyse what has not changed.
- **Filter noise before compare.** Drop `dependabot/*` branches and deduplicate
  branches at the same head sha, so the run does not spend API calls on automation
  or duplicates. Roll zero-ahead branches into one "no divergence" line per fork.
- **Low noise in the output.** Distinguish real features from churn. A branch that
  is many commits ahead but only refactored types or bumped a dependency has "no
  novel functionality", and must be recorded as such so it is not re-investigated.
- **Verify against current upstream.** Before listing a fork-branch feature or fix
  as missing, confirm upstream does not already have it (we ship fast; a branch
  that diverged months ago may be behind us on something it once led).
- **No em or en dashes**; absolute dates; one (fork, branch) per row.
- **Ideas, not auto-tickets.** Surface the backlog; let the user choose what to
  ticket. If they say so, hand a chosen idea to the normal ticket-creation flow.
```
