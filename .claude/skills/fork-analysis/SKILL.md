---
name: fork-analysis
description: Analyse every GitHub fork of this repo, and every meaningful BRANCH within each fork, to find features and functionality the forks added that upstream does not have, as a source of ideas to implement. For each newly-identified idea it opens a gate-ready GitHub tracking ticket (crediting the origin fork and original author, linking the exact code to review, flagging that the imported external code MUST get a security review, and requiring positive plus negative scenarios and test cases before implementation). Maintains docs/audit/FORK_ANALYSIS.md as a cache so unchanged fork branches are skipped on the next run. Use whenever the user asks to "analyse the forks", "what do the forks add", "scan forks for features", "fork feature scan", "any new ideas from forks", or wants to harvest fork ideas, even if they do not say the word "fork-analysis".
---

# Fork analysis

Survey the repo's forks AND each fork's branches, identify functionality a fork
branch has that upstream lacks, and record it in `docs/audit/FORK_ANALYSIS.md` so the
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
- The cache: `docs/audit/FORK_ANALYSIS.md`. Each row is a `(fork, branch)` pair and
  records that branch's `head` sha and `pushed`/analysed date at the time it was
  last looked at, plus the verdict. A `(fork, branch)` whose head sha is unchanged
  since the last analysis is skipped (its prior verdict carries forward). Branches
  that share a head sha (e.g. a feature branch identical to main) are deduplicated.

## Pipeline

### 1. Read the cache

Read `docs/audit/FORK_ANALYSIS.md` if it exists. Build a map of
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

### 5. Open a tracking ticket for each NEW idea (automatic)

For every NOVEL functionality item identified in step 4, open a gate-ready GitHub
issue, UNLESS the doc already records a ticket number for that idea (dedup: never
re-create a ticket on a re-run; the backlog table's `Ticket` column is the
source of truth). Skip items the analysis judged genuinely not-applicable to
upstream (record those in the doc without a ticket and say why).

Use the bug or feature template (`<!-- template-version: 3 -->`) so it is
gate-ready, with labels `enhancement` (or `bug` for a fix), an area label, and
`security` (the security label forces the security-auditor into the readiness
gate, which is mandatory here because the idea comes from external code). Write
body files into the repo root as a dot-file and delete them after the `gh` call
(the gh sandbox cannot read `/tmp`).

The ticket body MUST contain all of:

1. **Origin and attribution.** The fork (`owner/repo`), the branch, the commit
   sha(s), a link to the commit/compare, and an explicit credit to the ORIGINAL
   AUTHOR (the commit `author.login`, and the fork owner if different):
   "Idea sourced from @<author> in <fork>:<branch>." Credit them; this is their
   work.
2. **What it is.** One or two sentences on the functionality and why it is worth
   considering.
3. **Code to review.** The exact files and links to the fork's version at that
   branch (blob/raw URLs), plus the upstream files it would touch.
4. **Status: NOT ready to implement, further analysis required.** State plainly
   that this is a harvested idea from a fast scan, not a vetted spec, and must be
   designed properly before any code is written.
5. **A "Before implementation" task checklist** with, at minimum:
   - [ ] Further analysis of the approach and how it fits our architecture (do
     not copy-paste the fork code; reimplement to our conventions).
   - [ ] **Search online for common / industry best practices** for this kind of
     feature or fix, and align the design with them. The fork is one
     implementation, not necessarily the best or the safest; validate the
     approach against established patterns before adopting it.
   - [ ] Positive AND negative scenarios defined (Given/When/Then).
   - [ ] Positive AND negative test cases written (unit + e2e as applicable).
   - [ ] **SECURITY REVIEW (MANDATORY): this idea comes from external/third-party
     code. Run the security-auditor over the imported code and the reimplementation
     before adoption; never trust or paste fork code unreviewed.**
   - [ ] **Scan the SAME fork code for ADDITIONAL minor improvements the fast fork
     scan missed.** The fork scan only flagged the headline change; read the full
     diff and the surrounding files for adjacent fixes, edge-case handling, or
     small improvements we did not capture, and fold the worthwhile ones in.
6. The standard sections so it can pass the gate (acceptance criteria, security
   considerations, rollback, etc.).

After creating each ticket, capture its number to write into the doc (step 6).
Report the new ticket numbers; do NOT implement them (this skill only harvests
and tickets ideas).

### 6. Update docs/audit/FORK_ANALYSIS.md

Rewrite the doc from the template. For every analysed or skipped `(fork, branch)`
that has divergence, record a row: fork + link, branch, ahead/behind, head sha,
analysis date (absolute UTC), and the verdict. Roll the zero-ahead branches of a
fork into a single "no divergence" line for that fork so the table stays readable.
Maintain a deduplicated **Feature ideas backlog** section aggregating the novel
functionality across all fork branches, each tagged with `fork:branch` and a rough
effort/value note, so it reads as a candidate-ticket list.

Record the ticket number created in step 5 next to each idea in the **Feature
ideas backlog** table's `Ticket` column. This is the dedup key: on the next run,
an idea that already has a ticket number is not re-ticketed.

Keep prior verdicts for skipped branches verbatim (only refresh the `behind`
count and note "unchanged, not re-analysed").

### 7. Report

Summarise to the user: how many fork branches were analysed vs cache-skipped vs
no-divergence, and the new or changed feature ideas worth considering (point at
the backlog section). Offer to open tickets for the most valuable ideas, but do
not open them automatically.

## docs/audit/FORK_ANALYSIS.md template

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

| Idea | From | Ticket | Rough value | Rough effort | Notes / overlap with existing |
|------|------|--------|-------------|--------------|-------------------------------|
| <feature> | owner/repo:branch | #NNN | high/med/low | S/M/L | <does upstream partially have it?> |
```

The `Ticket` column is the dedup key: an idea that already has a ticket number is
not re-ticketed on the next run.

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
- **Auto-ticket every NEW idea, exactly once.** Open a gate-ready ticket per
  novel finding (step 5), and record its number in the backlog `Ticket` column.
  On a re-run, an idea that already has a ticket is NOT re-ticketed: dedup on that
  column. Every such ticket MUST credit the original author, link the fork code to
  review, state that further analysis is required, and carry the mandatory tasks:
  search online for common practices, define positive AND negative scenarios and
  test cases, run a security review of the external code, and scan the same fork
  code for additional improvements the fast scan missed. This skill only harvests
  and tickets ideas; it never implements them.
```
