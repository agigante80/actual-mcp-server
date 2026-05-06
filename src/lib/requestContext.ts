import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request AsyncLocalStorage. Carries the active MCP sessionId across
 * async boundaries so adapter / tool code can identify which session is
 * making the call without threading an argument through every layer.
 *
 * Producer: src/server/httpServer.ts wraps each `transport.handleRequest()`
 * call in `requestContext.run({ sessionId }, …)`.
 *
 * Consumer: src/lib/actual-adapter.ts uses `requestContext.getStore()?.sessionId`
 * to decide whether the session has an initialised pool connection it can
 * reuse (eliminating the per-op login burst — see #134).
 *
 * Lives in src/lib/ rather than src/server/ to avoid the circular import that
 * would otherwise exist between httpServer.ts and actual-adapter.ts.
 */
export const requestContext = new AsyncLocalStorage<{ sessionId?: string }>();
