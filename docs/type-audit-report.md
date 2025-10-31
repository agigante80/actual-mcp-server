# Type Audit & Remediation Report

Date: 2025-10-31

Summary
-------
I performed a repo-wide audit to remove ad-hoc `any` usages and tighten types where safe. Key goals were:

- Replace `any` and unsafe casts with `unknown` or concrete generated types where possible.
- Export and unit-test adapter normalization helpers.
- Add small runtime guards for dynamic JSON shapes.
- Tighten `observability` to avoid `ts-ignore` and explicit `any` usage.
- Keep changes minimal and well-tested to avoid behavioral regressions.

What I changed (high level)
---------------------------
- Updated adapter (`src/lib/actual-adapter.ts`) to use `components` types from `generated/actual-client/types.ts`. Added `RawAddTransactionsResult` and narrowed several raw API return shapes.
- Rewrote `callWithRetry` to forward typed options to `retry` (removed `as any`).
- Tightened runtime code to avoid `(err as any)` and similar unsafe casts in `src/index.ts`, `src/server/httpServer_testing.ts`, `src/tests/testMcpClient.ts`.
- Improved the streamable-http shim typings and some server test code to narrow `extra`/`params` shapes.
- Reworked `src/observability.ts` to use a small `CounterLike`/`RegistryLike` interface and avoid `@ts-ignore`.
- Adjusted the tools generator scripts and generated tool stubs to use `unknown` where the OpenAPI spec was not precise.
- Added unit/smoke tests:
  - Adapter normalization/concurrency/retry tests (existing runner)
  - Observability smoke test (`src/tests/observability.smoke.test.ts`)
  - Generated tools smoke test (existing test harness)

Files edited (not exhaustive)
----------------------------
- src/lib/actual-adapter.ts — tightened promises and return types
- src/observability.ts — replaced ts-ignore and tightened runtime typing
- src/server/httpServer_testing.ts — safe narrowing for relatedRequestId and progress token
- src/tests/testMcpClient.ts — removed `any` fetch typing and added robust JSON guards
- scripts/generate-tools.ts — avoid `any` generation where possible (use `unknown`)
- scripts/generate-tools-node.js — safer defaults (left some z.any fallbacks)
- src/server/streamable-http.ts / .d.ts — shim types improved (some `any` remain in d.ts consumable shims)
- src/tests/observability.smoke.test.ts — new smoke test

Remaining hotspots (intentional or awaiting further data)
----------------------------------------------------
These remain as `any`/`unknown` in places where the code needs to accept flexible runtime shapes or where automated generation lacks exact OpenAPI detail. Priorities listed.

High priority (tighten when OpenAPI improved or runtime is controlled):
- `types/actual-app__api__dist__methods.d.ts` — ambient declarations use `...args: any[]` for raw API methods. These can be refined by mapping each declared method to the exact `components` return types.
- `src/server/streamable-http.d.ts` — several methods still declared with `any` because the shim mirrors an external transport API. Replace with precise types after confirming transport contract.

Medium priority:
- `src/tools/*.ts` generated stubs contain `type Output = any` comments; these can be updated to precise `paths['...']` types where the OpenAPI operationId is present and mapped.
- `scripts/generate-tools.ts` / `generate-tools-node.js` still include `z.any()` fallbacks when the OpenAPI fragment doesn't describe the payload fully. Improve generator input or enhance the OpenAPI fragment.

Low priority / acceptable runtime guards:
- `src/tests/testMcpClient.ts` uses runtime checks on parsed JSON (keeps `unknown` shapes). This is safer than assuming a concrete type for remote JSON.
- Small `as any` uses left to adapt to runtime-only code (e.g., dynamic wins ton transport instantiation in `src/logger.ts`) — these are low-risk and well-contained.

Verification performed
----------------------
- TypeScript build: PASS (tsc completed)
- Adapter tests: PASS (normalization + concurrency/retry)
- Observability smoke test: PASS
- Generated tools smoke test: PASS (existing harness)

Recommended next steps
----------------------
1. If you want strict typing everywhere, update the OpenAPI spec so the generator can emit precise input/output types for all tools. Then re-run generation and remove the remaining `z.any()` and `Output = any` stubs.
2. Replace the shim `.d.ts` for `streamable-http` with precise interfaces matching the transport consumer's expectations (or vendor-provide the real package types).
3. Refine `types/actual-app__api__dist__methods.d.ts` by mapping each method to the corresponding `components` types (easy to script from the openapi/types mapping).
4. Optionally adopt a test framework (Jest/Mocha) for clearer test reporting; current lightweight runner is intentionally minimal to avoid adding dependencies.

If you want, I can open a PR with these changes and include this report as the PR description.
