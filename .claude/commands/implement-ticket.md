Implement a GitHub issue end to end: gate to 10/10, build, validate, code-review, fix-or-ticket, then commit + bump + push develop.

## Usage

Accepted argument: `<issue-number>` (required)

Example: `/implement-ticket 178`

## Steps

Follow the `implement-ticket` skill at `.claude/skills/implement-ticket/SKILL.md`. Read that file and execute its pipeline against the issue number passed as the argument.

In short: gate the ticket to 10/10 (auto-fix the body and re-run, no confirmation), implement it per the spec and CLAUDE.md conventions, run the fast validation sequence, run `/code-review` at high effort, fix findings inline when in-scope and low-risk or spin them into their own gate-ready tickets (auto-implementing those up to recursion depth 2), run `/local-env full`, then commit to develop, bump the patch version, and push develop. After pushing, confirm the GitHub Actions CI run for the pushed commit concludes green (a red or unchecked CI run means the ticket is NOT done; fix or ticket the failure). Never touch main. Never use em or en dashes.
