---
name: release-automation
description: Enforce and automate releases in CI so a promotion to main can never silently ship without a version bump. Documents and governs the release gate (block a main promotion that did not bump VERSION past the last vX.Y.Z tag) plus, on the same VERSION<->tag primitive, the auto-release lanes that already ship in this repo (auto-release a verified @actual-app/api dependency update). The enforced/automated sibling of the invoked `release` skill. Use when the user asks to "enforce version bumps", "block merge without a release", "auto release on merge", "auto-release dependency updates", or "stop forgetting to tag releases".
---

<!-- release-automation-version: 8 -->

# Release automation

Make the missing release impossible. The `release` skill (`.claude/skills/release/SKILL.md`) is
the *invoked* ship someone runs; this is the *unattended* layer that runs without being invoked,
so a promotion to `main` with no version bump is **blocked** (or, for verified dependency
updates, auto-bumped), never silently shipped. In this repo the layer is already partly
installed: a local release-gate hook plus two auto-release workflows. This skill documents how
the pieces compose and how to maintain them.

> **Composition, not duplication.** Semver rules and the version source live in the `release`
> skill and the version-marker section of `CLAUDE.md` (canonical `VERSION` file, mirrors managed
> by `scripts/version-bump.js`). This skill *enforces* them, it does not restate them.

## The one mechanism: VERSION vs latest tag

All lanes share a single primitive: compare the working-tree `VERSION` against the latest
**released `vX.Y.Z` tag** (not the previous commit; the tag is the only truth for "what is
released") and act on one verdict:

| Verdict | Meaning | What a lane does with it |
|---|---|---|
| `first-release` | no release tag yet | allow (historical only; this repo has tags since v0.x) |
| `ahead` | `VERSION` > latest tag, already bumped deliberately | **ship as-is, never re-bump** |
| `equal` | `VERSION` == latest tag, nobody bumped | the lane's policy decides (block, or auto-patch) |
| `behind` | `VERSION` < latest tag, branch is stale | **hard stop (regression)** |

The `ahead`/`behind` handling is the load-bearing part: it is what stops a naive "always patch on
merge" from double-bumping a deliberate `0.8.0` into `0.8.1`, and what refuses to publish a
regression. In this repo the primitive is implemented twice, single-sourced by intent:

- **`scripts/version-bump.js` (the write path):** before any bump it runs the production-tag
  freshness check (`git ls-remote --tags origin`) and **aborts on `behind`**. This is the guard
  against the parallel-bump pattern (the scheduled auto-release ships while a local branch is
  unsynced). Recovery: `git fetch origin && git merge origin/main`. Override only with
  `--force`, and only when production is genuinely wrong; the `release-manager` agent requires
  explicit user confirmation first.
- **`npm run version:check` (`scripts/version-check.js`, the read path):** verifies the
  canonical `VERSION` and its mirrors (`package.json`, doc `**Version:**` markers, container
  labels) agree, so the verdict is computed over one value, not several drifting ones. It runs
  in the Validate job of `.github/workflows/ci-cd.yml` and in pre-commit; drift fails closed. If
  it fails, `npm run version:bump -- sync` re-syncs mirrors without bumping.

## The three lanes (route by who authored the change)

| Lane | Trigger | Policy on `equal` | Status here |
|---|---|---|---|
| **A (Gate)** | promoting `develop` to `main` (the `/release` fast-forward) | **block the promotion** | installed (local hook + bump-script guard) |
| **B (Auto-release on dependency)** | verified `@actual-app/api` update, CI green | auto-patch + tag + release | installed (one workflow, see below) |
| **C (Auto-release on merge)** | every green merge to the production branch | auto-patch + tag + release | **not installed, and should stay out** |

The routing rule: **auto-bump only where there is no human author and impact is bounded**
(the `@actual-app/api` dependency lane); **gate where a human must declare impact** (everything
that lands on `develop` through implement-ticket / merge-pr). A gate fails loud and early and
needs no tokens; auto-bump needs an App token + a recursion guard, so it is confined to the one
lane that genuinely earns it.

## Lane A: the release gate

This repo does not merge PRs into `main`; `main` only moves by the `/release` skill's
`git merge --ff-only origin/develop` push. The gate therefore lives at the push boundary, not as
a PR check:

- **`.claude/hooks/require_green_develop_before_main.py`** blocks any push to `main` unless
  `develop` is version-bumped past the latest published tag AND its HEAD CI run concluded
  `success`. `equal` means "you didn't bump: run `npm run version:bump -- patch` (or `minor` /
  `major` per the change's impact) and commit on develop"; `behind` means "develop is stale,
  `git fetch origin && git merge origin/main` first".
- **`scripts/version-bump.js`'s freshness abort** backstops the same rule on the write side, so
  even a session without the hook armed cannot mint a stale version.

The `release` skill re-verifies the same preconditions explicitly (its "Preconditions" section)
and never forces the gate. Never "fix" a red gate by overriding it; fix the bump or wait for CI.

Zero machinery: no tokens, no recursion, no concurrency. It only reads.

## Lane B: auto-release on dependency update (installed)

The one auto-bump that is safe by construction: the author is automation (no human to make the
bump call) and the impact is bounded (consume an upstream `@actual-app/api` release -> PATCH).
One workflow implements it:

- **`.github/workflows/dependency-update.yml`** (scheduled daily 01:00 UTC + manual dispatch):
  a single sequential job that checks npm for a new `@actual-app/api`, installs it on a
  temporary `deps/actual-api-<version>` branch, then runs build, tool-coverage check, unit
  tests, and the full Docker E2E suite. Only if ALL are green does it run
  `npm run version:bump -- patch` (plus `npm install --package-lock-only` so the release
  commit passes `npm ci`, per #261), fast-forward `main` from the branch, tag `vX.Y.Z`, verify
  the tag actually triggered the publish pipeline and watch it to success, create the GitHub
  Release only after that guard passes, then fast-forward `develop` back in sync (or open a
  sync PR if develop diverged, per #145). Because the job is sequential, a red step means no
  bump, no merge, no tag.

A second lane (a `workflow_run` listener that reacted to CI/CD success on `main`) was retired
by #266 (2026-07-05): it still pushed with `GITHUB_TOKEN`, so its tag could never trigger the
publish pipeline (the same failure mode as the v0.7.12 incident, whose root causes lived in
`dependency-update.yml` and were fixed by #261); it duplicated the writer role on `main` and
the tag namespace (double-bump risk); and its notes hardcoded a stale tool count. Invariant (h)
in `tests/unit/workflow_release_guards.test.js` keeps it retired: no workflow may use a
`workflow_run` trigger, and no governance file may reference the retired workflow's
identifier. `dependency-update.yml` is the ONLY auto-release writer to main.

Because the scheduled lane writes and must trigger the downstream publish pipeline, the
**GitHub App token** (`secrets.APP_ID` / `APP_PRIVATE_KEY`) authenticates the CHECKOUT
(`token:` on `actions/checkout`, per #261; the old `git remote set-url` token-in-URL form is
banned by guard invariant b): pushes made with the default `GITHUB_TOKEN` do not trigger
workflows on the same repo, so `ci-cd.yml` would never fire on the auto-bumped commit. Adopting
the App token forfeits that free loop immunity, which is why the lane's scope gate (only a real
`@actual-app/api` change) and the sequential all-green precondition matter.

Dependabot (`.github/dependabot.yml`) and Renovate (`renovate.json`) also file PRs, but those
target `develop` and ship through the normal implement-ticket / merge-pr / `release` path; they
do not auto-release. Anything not a verified `@actual-app/api` bump falls through to Lane A.

## Lane C: auto-release on merge (do not install here)

Lane C is the blanket auto-bump: **every** green merge to the production branch is released, no
dependency scope gate. It is only correct on a true continuous-deployment trunk where every
merge is genuinely a release. This repo is the opposite by design: releases are deliberate,
batched, human-triggered promotions of `develop` to `main` via the `release` skill, which also
closes the shipped tickets. Installing Lane C would bypass that skill's ticket-closing step and
add a second automated writer to main alongside the scheduled Lane B (the same double-writer
hazard whose other instance #266 retired).

**Lane C supersedes Lane B: never install both.** If this project ever moved to a CD trunk,
Lane C would replace both the Lane A gate's `equal` policy and the dependency workflow, not
join them. Until then: gate + Lane B, no Lane C.

## Maintaining the installation

The lanes are installed; maintenance means keeping them wired to reality:

1. The canonical **version source** stays the `VERSION` file, with `scripts/version-bump.js` as
   the only writer and `npm run version:check` as the drift guard. Never hand-edit `VERSION`,
   `**Version:**`, or `**Tool Count:**` markers (`scripts/version-bump.js` is in the
   do-not-modify tier of `CLAUDE.md`).
2. If `.github/workflows/ci-cd.yml` is renamed (the FILE, not just the display name), update
   the publish guard in `dependency-update.yml` (`gh run list --workflow ci-cd.yml`), or the
   guard reports "never triggered" on every release and blocks the GitHub Release step.
3. If the dependency lane's scope ever widens beyond `@actual-app/api`, keep the diff-based
   detection (never a commit-message grep) and keep the release strictly behind a green full
   test run.
4. Bump-level semantics (patch/minor/major) stay with the human on `develop`; the automation
   only ever patches, and only on `equal`. An `ahead` develop is released as-is by the
   `release` skill, never re-bumped.
5. The `release` skill remains the companion **invoked** workflow: the gate enforces, `release`
   is how a human cuts the release and closes the shipped tickets.

## Interaction with the rest of the kit

- **`/ci-health`** discovers all workflows and auto-fixes "safe" CI failures, but a red release
  gate or a skipped auto-release is an *intentional governance signal* (the author must bump,
  or the commit was not a dependency update), not a breakage. `ci-health` treats
  release/version-gate workflows as investigate-only (do **not** auto-fix), the same carve-out
  it uses for E2E and security scans. Never let `ci-health` "fix" a gate by auto-bumping.
- **`/dep-auditor`** finds dependency problems and files tickets; **Lane B** ships the
  `@actual-app/api` update once its full test run is green. They compose (auditor finds ->
  update lands -> Lane B releases).
- **`implement-ticket` / `merge-pr`** deliberately stop at `develop` with a bump already
  committed, which is what keeps the Lane A verdict `ahead` at release time.
- **Component markers** (`<name>-version`, checked by forge-kit) version the governance
  *components*; this skill versions the *product* (`VERSION` + `vX.Y.Z` tags). Different axes:
  do not conflate.

## Adapting this skill (notes for forge-adapt)

- Production branch is `main`, promotion source is `develop`, fast-forward only; the version
  source is the `VERSION` file via `scripts/version-bump.js`; CI provider is GitHub Actions.
- The gate is enforced client-side (hook + bump-script abort) because `main` takes direct
  fast-forward pushes, not PRs; if the flow ever moves to PRs into `main`, add a CI version
  gate as a required status check.
- Preserve the `<!-- release-automation-version: N -->` marker when adapting, so drift stays
  detectable. Honour the project's no-dash rule (`.claude/hooks/block-dashes.py`) in all
  release notes, tags, and issue comments.
