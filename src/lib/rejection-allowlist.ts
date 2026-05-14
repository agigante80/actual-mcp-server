/**
 * Predicate for the unhandledRejection allow-list in src/index.ts.
 *
 * Returns true when a rejection should be logged but the server should keep
 * running. Centralised here so it can be unit-tested without importing the
 * full server entrypoint.
 */
export function isKnownBenignRejection(reason: unknown): boolean {
  const reasonStr = String(reason);
  const reasonObj = reason as { type?: unknown } | null | undefined;

  return (
    reasonStr.includes('does not exist in table') ||
    (reasonStr.includes('Field') && reasonStr.includes('does not exist')) ||
    reasonStr.includes('Expression stack') ||
    reasonStr.includes('Date is required') ||
    reasonStr.includes('date condition is required') ||
    reasonStr.includes('Cannot create schedules with the same name') ||
    (reasonStr.includes('Schedule') && reasonStr.includes('not found')) ||
    reasonStr.includes('is system-managed and not user-editable') ||
    reasonStr.includes('is not an expense category') ||
    reasonObj?.type === 'BankSyncError' ||
    reasonStr.includes('BankSyncError') ||
    reasonStr.includes('NORDIGEN_ERROR') ||
    reasonStr.includes('RATE_LIMIT_EXCEEDED') ||
    reasonStr.includes('Rate limit exceeded') ||
    reasonStr.includes('Failed syncing account') ||
    reasonStr.includes('GoCardless') ||
    reasonStr.includes('SimpleFIN') ||
    reasonStr.includes('Authentication failed:') ||
    isActualApiWorkerRejection(reason)
  );
}

/**
 * Rejection that escapes from the @actual-app/api worker's internal cleanup
 * path. The known trigger is a non-writable MCP_BRIDGE_DATA_DIR causing an
 * EACCES during budget download, but the same code path emits a secondary
 * rejection for other internal failures too.
 *
 * The secondary rejection is an Error whose only set property is `stack`
 * (no code/errno/syscall, even non-enumerable, on the rejection itself; those
 * are on the PRIMARY error which ActualConnectionPool already catches).
 * Anchoring on the stack alone is therefore the correct signal.
 *
 * Two-anchor disjunction:
 *   - 'download-budget': the precise frame for today's known trigger.
 *   - '@actual-app/api/dist': the durable path anchor; survives upstream
 *     handler renames as long as the package is still loaded from a
 *     conventional npm install path.
 */
export function isActualApiWorkerRejection(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const stack = (reason as { stack?: unknown }).stack;
  if (typeof stack !== 'string') return false;
  return stack.includes('download-budget') || stack.includes('@actual-app/api/dist');
}
