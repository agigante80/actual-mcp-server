---
name: merge-pr
description: >-
  Handle a request to merge a GitHub pull request in actual-mcp-server WITHOUT
  ever merging it directly. Instead, create a gate-ready GitHub ticket to
  integrate the PR's change onto develop, run that ticket through the full
  implement-ticket pipeline (gate to 10/10, implement, validate, code review,
  mandatory /local-env full, commit + patch bump + push develop, confirm CI
  green), then close the original PR as superseded. The change only ever reaches
  main later through the normal develop-to-main release. Use this whenever the
  user asks to merge, accept, land, or pull in a pull request by number or
  reference, e.g. "merge PR 179", "merge this pull request", "land the dependabot
  PR", "accept #42", or "/merge-pr 179". Do NOT use it for the develop-to-main
  release itself, or for git branch merges that are not GitHub PRs.
---

# Merge PR (develop-first, never direct)

A request to "merge a PR" is treated as a request to INTEGRATE the PR's change
through the normal process, not to click merge. Direct PR merges are forbidden
here: most PRs (Dependabot especially) target `main`, and merging them straight
in would bypass the develop-first workflow, skip the version bump and the live
`/local-env full` gate, and re-diverge `main` from `develop`. Every change earns
its way to `main` the same way: develop -> ticket -> gate -> implement -> bump ->
`/local-env full` -> CI green -> (later) an explicit release.

## The hard rule

- NEVER run `gh pr merge` (or merge the PR in the UI) as part of this skill.
- A version bump and a passing `/local-env full` are NON-NEGOTIABLE prerequisites
  for anything that will eventually reach `main`. A PR provides neither on its
  own, so it must go through the ticketed pipeline first.
- The original PR is CLOSED as superseded once its change lands on `develop`. It
  never merges to `main`.

## Inputs

The PR number (extract it from the request; if absent, ask). Everything happens
on `develop`; `main` is untouched.

## Pipeline

### Phase 1: Inspect the PR

Read it so the integration ticket is accurate and the change is reproducible:

```
gh pr view <n> --json title,baseRefName,headRefName,labels,author,url,mergeable,statusCheckRollup
gh pr diff <n>                 # the actual change
gh pr diff <n> --name-only     # files touched
```

Classify it: dependency bump (Dependabot) vs code change; security/CVE driver
(check `npm audit` for the package and the PR's referenced advisories); which
files; whether the dep is direct or transitive (`npm ls <pkg>`). Note the
resolved target versions from the lock diff so they can be reproduced exactly.

### Phase 2: Refuse the direct merge, explicitly

State plainly that the PR will not be merged directly, and that its change is
being routed through the develop-first pipeline (ticket + gate + bump +
`/local-env full`). This is the policy, not a limitation.

### Phase 3: Create the integration ticket

Open a gate-ready GitHub issue (bug or feature/infra template v3, with the
`<!-- template-version: 3 -->` marker and an area label) titled like
`Integrate PR #<n> onto develop: <summary>`. The body must:

- summarise the PR's change and its driver (e.g. the CVE/advisory it fixes),
- record the exact target versions / diff to reproduce,
- cross-reference the PR URL,
- carry acceptance criteria and Given/When/Then scenarios, including the
  mandatory `/local-env full` gate and (for a dependency bump) an `npm audit`
  assertion that the advisory is cleared,
- target branch `develop`, patch version bump acknowledged.

Comment on the PR linking the new ticket so the trail is two-way.

### Phase 4: Run the implement-ticket pipeline on the new ticket

Hand the ticket number to the `implement-ticket` skill (or run its phases):
gate to 10/10, implement, fast validation, `/code-review`, fix inline or spin
off tickets, `/local-env full`, commit + bump + push develop, then Phase 8
(confirm the CI run for the pushed commit is green).

The IMPLEMENTATION step reproduces the PR's change on `develop`:

- **Dependency bump (direct dep):** `npm install <pkg>@<target>` (matching the
  PR's resolved version), then build + tests.
- **Dependency bump (transitive):** reproduce the PR's lock change, e.g.
  `npm update <pkg>` within the allowed range, or an `npm overrides` entry only
  if the parent pins it (follow CLAUDE.md's overrides-are-a-last-resort rule).
  Verify `npm ls <pkg>` and the lock show the PR's target version and that
  `npm audit` no longer flags it.
- **Code PR:** apply or cherry-pick the PR's diff onto `develop`; do not blindly
  trust it, review and adjust to the codebase.

`/local-env full` is mandatory here, per the user's standing rule, not optional.

### Phase 5: Close the PR as superseded

Once the change is on `develop` (green CI), close the original PR with a comment:
its change has been integrated via `develop` in `<commit>` under the integration
ticket, and it will reach `main` through the normal release, so the PR is closed
rather than merged. Use `gh pr close <n> --comment "..."` (NOT `gh pr merge`).

### Phase 6: Report

Report the integration ticket number, the develop commit + new version, the CI
conclusion, the `npm audit` delta (for a dependency bump), and that the PR was
closed as superseded. Note that the change reaches `main` only on the next
explicit develop-to-main release.

## Guardrails

- **Never merge the PR directly**, and never push to `main`. The skill ends on
  `develop` with the PR closed-as-superseded.
- **Bump + `/local-env full` are prerequisites**, always, before the change is
  release-eligible. No exceptions for "it's just a lockfile bump".
- **CI must be green** on the develop commit (implement-ticket Phase 8) before
  the ticket is called done.
- **No em or en dashes** anywhere (CLAUDE.md hard rule). A PreToolUse hook
  enforces it; self-check regardless.
- **Honest reporting.** If any phase fails or is skipped, say so with evidence.

## Relationship to other skills

This skill is the PR-shaped front door to `implement-ticket`: it converts a PR
into a develop-first integration ticket and then runs the same pipeline. It does
not duplicate that pipeline; it delegates to it after capturing the PR.
