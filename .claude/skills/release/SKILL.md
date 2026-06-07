---
name: release
description: The develop-to-main release. Fast-forward main to develop, tag the new version, confirm the publish pipeline is green, AND close the implemented tickets the release ships. Use whenever the user asks to "release", "merge to main", "ship to main", "push to main", "cut a release", "do a release", "release vX.Y.Z", or "promote develop to main". This is the ONLY sanctioned path to main; implement-ticket and merge-pr deliberately stop at develop.
---

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
3. develop CI is green on its HEAD: find the CI/CD Pipeline run for
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
Report: the version released, the main short sha, the release run id + conclusion,
the published artifacts (npm + Docker + GitHub Release), and the list of tickets
closed (with any skipped-as-already-closed noted). Confirm `develop` and `main`
are now in sync.

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
- **No em or en dashes** anywhere (commits, tags, issue comments).
- **This is the only path to main.** It complements implement-ticket (which ends
  on develop) and merge-pr (which routes a PR onto develop, never main).

## Relationship to other skills

- `implement-ticket`: builds a ticket and lands it on develop with a version bump,
  leaving the issue OPEN. `release` is what later ships those develop commits to
  main and closes the issues. The two are designed to meet here.
- `merge-pr`: converts a PR into a develop integration, also leaving main untouched;
  its change reaches main through this skill on the next release.
