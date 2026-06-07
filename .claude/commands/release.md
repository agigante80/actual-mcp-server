Release the current `develop` to `main`: fast-forward main, tag the new version, confirm the publish pipeline is green, and close the GitHub issues the release shipped. This is the only sanctioned path to main (implement-ticket and merge-pr stop at develop).

## Usage

Accepted argument (optional): an expected version (e.g. `0.6.40`) to assert against the VERSION on develop as a safety check.

Examples: `/release`, `/release 0.6.40`

## Steps

Run the `release` skill (`.claude/skills/release/SKILL.md`). It:

1. Verifies the release preconditions (develop ahead of main, version-bumped, develop CI green); stops with a clear next action if any fails, never forcing the release-gate hook.
2. Computes the release manifest: the version to tag, and the implemented tickets to close (the `(#N)` references in commit subjects in `main..develop`, never the CVE/alert numbers in commit bodies).
3. Fast-forwards `main` to `develop` and pushes; waits for the main-push CI run to go green (the same-SHA wait the release-gate hook requires before tagging).
4. Tags `vX.Y.Z` and pushes the tag; waits for the release pipeline (npm + multi-arch Docker + Docker Hub + Create Release) to go green.
5. Closes each implemented ticket that is still open, with a "Released in vX.Y.Z" comment.
6. Returns to `develop` and reports the version, the release run conclusion, the published artifacts, and the tickets closed.
