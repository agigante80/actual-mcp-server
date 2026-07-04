---
name: release
description: The develop-to-main release. Fast-forward main to develop, tag the new version, confirm the publish pipeline is green, AND close the implemented tickets the release ships. Use whenever the user asks to "release", "merge to main", "ship to main", "push to main", "cut a release", "do a release", "release vX.Y.Z", or "promote develop to main". This is the ONLY sanctioned path to main; implement-ticket and merge-pr deliberately stop at develop.
---

<!-- release-version: 5 -->

# Release (develop to main)

Promote the current `develop` to `main` as a versioned release, then close the
GitHub issues that release implemented. The implement-ticket pipeline stops at
develop on purpose; this skill is the explicit, human-triggered step that ships
develop to main and tidies the tracker so implemented tickets do not linger open.

The closing-tickets step is the reason this skill exists: without it, every
ticket implemented since the last release stays open after shipping, and closing
them by hand is easy to forget.

## When this runs

Any request to release / merge develop to main. Optional argument: an expected
version (e.g. `0.6.40`) to assert against the VERSION on develop as a safety
check. Everything is on `main` and the tag; `develop` is the source.

No em or en dashes anywhere (CLAUDE.md hard rule). Honest reporting: never claim
released until the release pipeline is green.

## Version sources (single source of truth + mirrors)

The canonical version is the `VERSION` file. Everything else is a mirror that
must be kept equal to it: `package.json` `version`, the doc `**Version:**`
markers, and container labels. `scripts/version-bump.js` propagates the bump to
all mirrors; `scripts/version-check.js` (run as `npm run version:check`) fails
if any mirror disagrees, and runs in the `Validate` CI workflow and pre-commit
so drift is caught before release, not during it.

## Bump modes (semver)

| Mode | Effect |
|---|---|
| `patch` / `minor` / `major` | `npm run version:bump -- <level>`: bump `VERSION`, propagate to all mirrors, sync doc markers |
| `sync` | `npm run version:bump -- sync`: do NOT bump; only re-sync mirrors + doc markers to the current `VERSION` (fixes drift) |

The bump *level* is a human judgement; never auto-infer it. Operator contract:
breaking the deployment is `major`, an opt-in feature is `minor`, a fix / CVE /
dependency update is `patch`. Bumping is a single committed step
(`chore(release): bump version to X.Y.Z`) on develop BEFORE the release runs
(implement-ticket normally does this).

**Production-tag freshness guard:** before any bump, `scripts/version-bump.js`
queries `git ls-remote --tags origin` and aborts if the local `VERSION` is
BEHIND the latest published `vX.Y.Z` tag (the parallel-bump protection). If it
aborts, run `git fetch origin && git merge origin/main` and retry. `--force`
only with explicit user confirmation and only when production is genuinely wrong.

## Preconditions (verify; never force)

The release-gate hook (`.claude/hooks/require_green_develop_before_main.py`)
already blocks a main push unless develop is version-bumped AND CI-green. Verify
the same up front and STOP with a clear report if any fails, rather than forcing:

1. `git fetch origin`. `origin/develop` must be ahead of `origin/main`
   (`git rev-list --count origin/main..origin/develop` > 0). If 0, nothing to
   release.
2. develop is version-bumped: the `VERSION` on develop is greater than the latest
   published tag (`git describe --tags --abbrev=0 origin/main`). If not, the
   change needs `npm run version:bump -- patch` committed on develop first.
3. version sources agree: run `npm run version:check` (the `scripts/version-check.js`
   cross-source guard). It fails if the canonical `VERSION` and its mirrors
   (`package.json`, doc `**Version:**` markers, container labels) disagree, so drift
   is caught before the release rather than during it. If it fails, run
   `npm run version:bump -- sync` (re-syncs mirrors without bumping) and commit on
   develop first. This guard also runs in the `Validate` CI workflow and pre-commit.
4. develop CI is green on its HEAD: find the CI/CD Pipeline run for
   `origin/develop` HEAD and confirm it concluded `success`. A red or in-progress
   develop is not releasable.

If a precondition fails, report exactly which one and the single next action (run
the bump, wait for CI, etc.). Do not override the hook with `--force`.

## Pipeline

### 1. Compute the release manifest

```
VERSION=$(git show origin/develop:VERSION)            # the tag to cut
RANGE=origin/main..origin/develop
```
Collect the implemented tickets to close: the ticket references in commit
SUBJECTS in the range. implement-ticket writes them as a Conventional-Commit
suffix `(#NNN)`:
```
git log "$RANGE" --pretty=format:%s | grep -oE '\(#[0-9]+\)' | tr -d '()#' | sort -un
```
Use ONLY the subject `(#N)` form. Do NOT grep `#N` over commit BODIES: bodies
reference CVE/alert numbers and cross-links (e.g. "alert #88", "see #166") that
are not tickets to close. The bump commits (`chore(release): bump version`) carry
no `(#N)` and are correctly ignored.

### 2. Fast-forward main and push

```
git checkout main
git merge --ff-only origin/develop
git push origin main
```
`--ff-only` guarantees no divergence (main must be a strict ancestor of develop,
which the develop-first workflow ensures). If the merge is not a fast-forward,
STOP: main and develop have diverged and that must be reconciled by hand first.

### 3. Confirm the main-push CI is green (the same-SHA wait)

Pushing main fires a NEW CI run on that commit (CI is keyed by workflow + event +
ref, so the same SHA on develop then main produces separate runs). The
release-gate hook treats an in-progress run on that SHA as not-green and will
BLOCK the tag push. So wait for the main-push run to conclude `success` before
tagging:
```
gh run list --branch main --limit 5   # find the push run for the pushed SHA
gh run watch <id> --exit-status
```

### 4. Tag and push

```
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

### 5. Confirm the release pipeline is green

The tag triggers the CI/CD Pipeline run that publishes (npm, multi-arch Docker,
Docker Hub description, Create Release). Watch it to `success`:
```
gh run list --branch "v$VERSION" --limit 5   # the CI/CD Pipeline run on the tag
gh run watch <id> --exit-status
```
If any publish job fails, STOP and report; the release is not done until this is
green. (QEMU is no longer used for arm64 since #182, so the old illegal-instruction
flake should not recur; if a transient infra failure occurs, `gh run rerun --failed`.)

### 6. Close the implemented tickets

For each ticket number from step 1 that is still OPEN, close it as completed with
a release note; skip ones already closed:
```
for n in <tickets>; do
  state=$(gh issue view "$n" --json state --jq .state 2>/dev/null)
  if [ "$state" = "OPEN" ]; then
    gh issue comment "$n" --body "Released in v$VERSION (main @ $(git rev-parse --short origin/main)). Closing as shipped."
    gh issue close "$n" --reason completed
  fi
done
```
This is the step that keeps the tracker honest. Report which tickets were closed
and which were skipped (already closed).

### 7. Return to develop and report

```
git checkout develop
```
Report: the version released (old tag to new tag), the main short sha, the
release run id + conclusion, the published artifacts (npm + Docker + GitHub
Release), and the list of tickets closed (with any skipped-as-already-closed
noted). Confirm `develop` and `main` are now in sync.

## Guardrails

- **Never force the release gate.** If develop is not bumped + green, stop and
  fix that first (bump / wait for CI). The hook is a safety rail, not an obstacle.
- **Fast-forward only.** If main is not a strict ancestor of develop, stop; do not
  create a merge commit or force-push.
- **Green before tag, green before done.** Wait for the main-push CI before
  tagging (the hook enforces it), and for the release pipeline before declaring
  the release shipped. Never claim released on a red or unfinished run.
- **Close only real tickets.** Close only the `(#N)` subject references in the
  released range. Never close a number that appeared only in a commit body (those
  are CVE/alert/cross-references). Skip already-closed tickets silently.
- **No em or en dashes** anywhere (commits, tags, issue comments, release notes).
- **This is the only path to main.** It complements implement-ticket (which ends
  on develop) and merge-pr (which routes a PR onto develop, never main).

## Scope boundary

This is the release/versioning workflow for the *product* (the `VERSION` file
and `vX.Y.Z` tags of actual-mcp-server, repo agigante80/actual-mcp-server). It
is distinct from the per-component `<name>-version` markers forge-kit uses for
adapt-drift detection (like the `release-version` marker at the top of this
file): those version individual governance components, this versions the product.

## Relationship to other skills

- `implement-ticket`: builds a ticket and lands it on develop with a version bump,
  leaving the issue OPEN. `release` is what later ships those develop commits to
  main and closes the issues. The two are designed to meet here.
- `merge-pr`: converts a PR into a develop integration, also leaving main untouched;
  its change reaches main through this skill on the next release.
