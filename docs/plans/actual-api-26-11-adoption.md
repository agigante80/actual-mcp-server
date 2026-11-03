# Plan: Actual API 26.11 adoption

## Goal

Adopt stable `@actual-app/api` 26.11.0 (published 2026-11-02) and use the two upstream changes we contributed: `getScheduleDates` (actualbudget/actual#9020) for #479 and the `runBankSync` result (actualbudget/actual#8998) for #548. No Dependabot PR appeared for the bump, so it is #618. While preparing it, the local gates turned out to have run against Actual server 26.7.0 since July: `scripts/deploy-and-test.sh` pulled the image but never recreated the container, and `tests/e2e/run-docker-e2e.sh` never pulled. #618 fixes both scripts so the local stacks test the server version the release claims.

## Done looks like

- #618: `@actual-app/api` floor `^26.11.0` with the lockfile resynced; both local stacks start Actual server 26.11.0 and print its version; the full validation sequence and CI green.
- #479: `actual_schedules_dates` returns Actual's own dates, capped at 366, with unit, Docker E2E (HTTP and stdio) and integration coverage; tool count 84 to 85 everywhere; `npm run check:coverage` no longer lists `getScheduleDates`, which closes #617.
- #548: `actual_bank_sync` reports new, matched and updated ids with counts; the 30 s settle sleep and the op timeout are decided from a measured reproduction on 26.11.0, recorded in the commit; a live replay against a bank-linked account is recorded.
- One commit per ticket on `develop`, then `tests/e2e/run-docker-e2e.sh full` and `bash scripts/deploy-and-test.sh full` green on the final HEAD (chained, never in parallel), zero residue, then a release to `main`.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- The bump passed every gate because every gate still ran the old server: a script fix that only looked right, or a cached image, left a stack on 26.7.0 or 26.10.0. The release then broke on real servers.
- The awaited bank sync of 26.11 ran longer than `ACTUAL_OP_TIMEOUT_MS`, so an all-accounts sync reported "timed out", dropped the pooled connection and kept importing behind it; the caller retried and the user saw the confusion as duplicates.
- The 30 s settle sleep was removed on reasoning alone, a provider error still escaped as `unhandledRejection` on some path, and the process crashed or the error vanished.
- The schedule dates disagreed with the Actual UI for a weekend-moved or patterned schedule, because the tool read the wrong field of the schedule row or expanded the dates itself.
- A daily schedule over a long window flooded the client's context because the cap was applied after the call instead of being passed to it.
- The upgrade changed something outside the two methods (core 26.11.0, crdt 3.1.4, uuid 14), and the first sign was a user's sync failing, because the full dual-transport run was skipped or ran on a stale HEAD.

## Expected work

Not binding. In order:

1. #618: the bump, the two script fixes, validation.
2. #479: the tool, its adapter method and every doc sync item.
3. #548: reproduce the timing on 26.11.0, then the output shape, the settle and timeout decision, and the replay.
4. The two local full runs on the final HEAD, then the release.

## Out of scope

- Any other method or behaviour new in 26.11.0 beyond the two above; the drift lane reports them.
- Projecting recurring transactions in `src/lib/financial-analysis.ts` (`addFrequency` detects a frequency from transaction history, it does not expand schedules).
- Bank sync providers, quotas and scheduling of syncs.
- Dependabot #616 (jose, @types/node): no ticket, so untouched under the dependency policy.
