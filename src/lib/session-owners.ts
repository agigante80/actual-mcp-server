/**
 * Which principal created each MCP session.
 *
 * An MCP session id is bearer material for the Streamable HTTP transport, so a
 * session must only be usable, listable and closable by the principal that
 * created it. The principal is the one `resolvePrincipal` in httpServer.ts
 * derives from the verified request (the OIDC subject, `static-bearer`, or
 * undefined when auth is disabled), never a client-supplied value.
 *
 * This lives beside the transport table rather than on the connection-pool
 * entry on purpose: a pool entry is dropped and recreated during the life of
 * one MCP session (a budget switch onto another server, a transient upstream
 * error), and an owner stored there would vanish with it. The transport's
 * lifetime IS the session's lifetime, so httpServer records the owner when it
 * registers the transport and forgets it when the pool evicts the session.
 *
 * Lives in src/lib/ so the session tools can import it without importing the
 * HTTP server.
 */

const owners = new Map<string, string | undefined>();

export function recordSessionOwner(sessionId: string, principal: string | undefined): void {
  owners.set(sessionId, principal);
}

export function forgetSessionOwner(sessionId: string): void {
  owners.delete(sessionId);
}

/**
 * True when `principal` may use `sessionId`.
 *
 * A session with no recorded owner is treated as owned by "no principal"
 * (undefined). In auth-disabled and stdio modes every caller is that same
 * undefined principal, so nothing changes there; under OIDC or a static bearer
 * every caller has a principal, so an unrecorded session matches nobody.
 */
export function sessionOwnerMatches(sessionId: string, principal: string | undefined): boolean {
  return owners.get(sessionId) === principal;
}

/** Keep only the sessions `principal` owns. */
export function filterOwnedSessions<T extends { sessionId: string }>(
  sessions: readonly T[],
  principal: string | undefined,
): T[] {
  return sessions.filter((s) => sessionOwnerMatches(s.sessionId, principal));
}
