# Plan: Session admission hardening

## Goal

Make `MAX_CONCURRENT_SESSIONS` a hard bound on the HTTP server, then let an operator bound each principal under it. Since #572 several static-token clients can share one server, so one client opening sessions in parallel, or never closing them, can exceed the global cap (#581) or hold every slot (#577). Neither was reported by a user: both came out of reviewing #572, so #581 is reproduced before anything is built on it.

## Done looks like

- #581 reproduced first. If it reproduces: admission reserves a slot synchronously (no `await` between the count and the reservation), every exit path (init failure, timeout, close, idle eviction) releases it, and a unit row with 6 parallel initializes against a cap of 2 admits exactly 2. The row is red on the old code and green on the new. If it does not reproduce, #581 is closed with the evidence, and #577 is re-scoped onto whatever the real admission path is.
- #577: an optional `MAX_SESSIONS_PER_PRINCIPAL`, unset keeps today's behaviour. With it set to 2, alice's third session is refused while bob still gets in, and alice's 6 parallel initializes admit exactly 2. The 503 names only the caller's own cap and count. Config, `.env.example`, README and `docs/reference/configuration.md` move together, and `docs/SECURITY_AND_PRIVACY.md` replaces its "session pool is shared" limitation.
- One commit per ticket on `develop`. #577 adds an opt-in capability, so the release is a minor bump (v0.24.0). The phase ends with two green `bash scripts/deploy-and-test.sh full` runs over HTTP and stdio with zero residue, then a release to `main`.

## Fails if

Premortem: the phase is over and it failed badly. What happened?

- The reservation leaked. A path that leaves an initialize half done (a client disconnect mid-login, a timeout, an exception between reserve and connect) never released its slot, so after a day of normal use the server refused everyone with a 503 until it was restarted. That is worse than the race it fixed.
- The "fix" was an `await` away from atomic: the count and the reservation ended up on opposite sides of an `await`, the unit row still passed because the stub resolved synchronously, and the race survived.
- The per-principal cap counted the wrong principal. A request with no principal, or the legacy `static-bearer` shared by every holder of `MCP_SSE_AUTHORIZATION`, was capped as one client, so on an existing single-token deployment the new limit silently lowered the effective global cap.
- The 503 leaked another principal's session count, and so told one client how busy the others were.
- #581 was built from the reading alone, without a reproduction, and fixed a race whose real shape was different, so #577 sat on a reservation that did not hold.

## Expected work

Not binding. In order:

1. #581: reproduce with a stubbed slow login, then the synchronous reservation in `src/lib/ActualConnectionPool.ts`, used by the admission check in `src/server/httpServer.ts`.
2. #577: the per-principal count inside the same reservation, the config variable, and the docs.
3. Two full dual-transport runs, then release v0.24.0.

## Out of scope

- stdio: one session per process, nothing to bound.
- Rate limiting of requests within a session, and any change to the idle timeout.
- Actual API 26.11 adoption (#479, #548): the next phase.
