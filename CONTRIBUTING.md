# Contributing & Auto-merge Guide

To reduce manual overhead, this repository supports an "automerge" workflow.

How to request auto-merge
1. Open a PR against `develop` with focused changes (one concern per PR).
2. Ensure the PR passes CI (build + unit tests + Playwright smoke tests).
3. Add the `automerge` label to the PR — the GitHub Action will attempt to merge when checks are green.

Notes
- Branch protection may still require approvals; ensure PR meets your org's policies.
- If auto-merge fails due to merge conflicts or failing checks, maintainers should resolve manually.
