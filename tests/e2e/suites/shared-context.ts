/**
 * tests/e2e/suites/shared-context.ts
 *
 * Mutable shared state passed to all E2E suite registration functions.
 * Created once per test run in docker-all-tools.e2e.spec.ts and mutated by:
 *   - beforeAll   → sessionId (set from initialize response)
 *   - suite tests → ctx.* IDs (set on create, cleared on delete)
 *
 * Key naming mirrors tests/manual/mcp-client.js context for cross-suite consistency.
 */

export interface TestContext {
  accountId?: string;
  accountName?: string;
  categoryGroupId?: string;
  categoryId?: string;
  payeeId?: string;
  payeeId2?: string;
  transactionId?: string;
  ruleId?: string;
  ruleWithoutOpId?: string;
  rulesUpsertId?: string;    // written by rules.ts (actual_rules_create_or_update)
  scheduleOneOffId?: string; // written by schedules.ts
  scheduleRecurId?: string;  // reserved: written when a recurring schedule test is added
}

export interface SharedState {
  /** MCP session ID, set in beforeAll from the initialize response header. */
  sessionId: string;
  /** Accumulated entity IDs created during the test run. */
  ctx: TestContext;
}

export function createSharedState(): SharedState {
  return { sessionId: '', ctx: {} };
}
