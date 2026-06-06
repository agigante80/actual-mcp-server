Handle a "merge this PR" request the safe, develop-first way: never merge directly; integrate the PR's change onto develop through the full pipeline.

## Usage

Accepted argument: `<pr-number>` (required)

Example: `/merge-pr 179`

## Steps

Follow the `merge-pr` skill at `.claude/skills/merge-pr/SKILL.md`. Read that file and execute its pipeline against the PR number passed as the argument.

In short: do NOT run `gh pr merge`. Inspect the PR, create a gate-ready GitHub ticket to integrate its change onto develop, run that ticket through the `implement-ticket` pipeline (gate to 10/10, implement by reproducing the PR's change on develop, fast validation, `/code-review`, mandatory `/local-env full`, commit + patch bump + push develop, confirm CI green), then close the original PR as superseded. The change reaches main only on the next explicit develop-to-main release. Never touch main. Never use em or en dashes.
