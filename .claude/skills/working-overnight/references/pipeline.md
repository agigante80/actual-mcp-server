# working-overnight: per-task governance pipeline

Every implementation task runs through these in order. Reuse the existing
components; do not reinvent them.

1. **Best practice (research).** Web-search the current best practice for the
   specific change (framework, security, testing idioms). Note what you found.
2. **Project rules.** Apply CLAUDE.md (this project keeps its coding standards
   INLINE in CLAUDE.md, there is no separate docs/coding-standards.md). Honour the
   hard rules: no em/en dashes, amounts in integer cents, dates as `YYYY-MM-DD`,
   `withActualApi` around every Actual call, `createTool` for new tools. Match the
   surrounding code.
3. **Tests first (TDD).** Derive cases from the ticket's GWT and test specs. Write
   the failing test, then the implementation (superpowers:test-driven-development).
   Wire new unit tests into the `test:unit-js` chain.
4. **Security.** Run the security-auditor over the change. For anything touching
   auth (OIDC, bearer, budget ACL), input handling, `actual_query_run` SQL, or data
   exposure, treat findings as blocking.
5. **Verify.** Run the project validation sequence (`npm run build`,
   `npm run verify-tools`, `npm run test:unit-js`, `npm run test:adapter`,
   `npm audit --audit-level=moderate`) and drive the real behavior
   (superpowers:verification-before-completion), not just the test suite.
   Unattended work over-verifies. Do NOT run `/local-env` or `test:integration:*`
   unattended (they need Docker + a real `.env`); leave live validation for the human.
6. **Land.** Commit on a branch in the item's worktree, open a PR targeting
   `develop` (never `main`) whose body links the ticket and lists what was verified.
   Never merge. (The attended `implement-ticket` flow commits straight to `develop`;
   unattended work uses a PR-to-develop so the human reviews before it lands.)

To gate a ticket, run the `/gate-ticket` flow (ticket-gate): a clean 10/10 pass
moves it to the ready queue; a non-pass parks it with the gate's scorecard. Ready
tickets are implemented via the `/implement-ticket` pipeline.

For an investigation, run the relevant review (`/full-review` or the built-in
security-review), write findings, and create gate-ready tickets for actionable
items within the investigation-depth cap, then let a later cycle gate and implement them.
