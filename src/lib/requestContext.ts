import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request AsyncLocalStorage. Carries the active MCP sessionId and the
 * allow-listed budget sync IDs across async boundaries so adapter / tool
 * code can identify the request without threading arguments through every
 * layer.
 *
 * Producer: src/server/httpServer.ts wraps each `transport.handleRequest()`
 * call in `requestContext.run({ sessionId, allowedBudgets }, …)`.
 *
 * Consumers:
 *   * src/lib/actual-adapter.ts: pool-vs-legacy branch decision via
 *     `requestContext.getStore()?.sessionId` (see #134).
 *   * src/lib/actual-adapter.ts: ACL enforcement at the top of withActualApi
 *     via `requestContext.getStore()?.allowedBudgets` (see #156).
 *
 * Lives in src/lib/ rather than src/server/ to avoid the circular import that
 * would otherwise exist between httpServer.ts and actual-adapter.ts.
 *
 * Note: `allowedBudgets` semantics mirror the budget-acl middleware output.
 * `['*']` means unrestricted; `[]` means no access. When `allowedBudgets` is
 * undefined (e.g. stdio mode or no requestContext.run wrapper), the adapter
 * falls back to its trusted-local short-circuit when AUTH_PROVIDER is not
 * 'oidc'.
 */
export const requestContext = new AsyncLocalStorage<{
  sessionId?: string;
  // Correlation id stamped on every log line (#221). Taken from an inbound
  // `X-Correlation-ID` header when present, otherwise generated per request.
  requestId?: string;
  allowedBudgets?: string[];
  // Authenticated principal (OIDC subject, or a stable constant for static-bearer
  // mode). Used by the per-principal budget preference (#189) to restore a user's
  // last active budget after a restart. Undefined when there is no authenticated
  // identity (stdio / auth-disabled), in which case the preference simply no-ops.
  principal?: string;
}>();
