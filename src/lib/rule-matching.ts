/**
 * Rule identity for the idempotent upsert behind `actual_rules_create_or_update`.
 *
 * #376 moved this out of `src/tools/rules_create_or_update.ts` so `adapter.upsertRule` can
 * own the read-match-write cycle. The logic is unchanged; extracting it keeps the matching
 * rules unit-testable on their own and keeps `actual-adapter.ts` from growing a second
 * concern.
 *
 * Two rules are "the same rule" when they carry the same SET of (field, op, value) triples
 * and the same `conditionsOp`. Order within the conditions array is deliberately irrelevant:
 * an AI client that regenerates the same rule with its conditions in a different order must
 * not create a duplicate, which is the whole point of the tool.
 */

/** Canonical JSON for one object: keys sorted, `undefined` values dropped. */
export function canonicalize(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] !== undefined) sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

export type RuleCondition = { field: string; op: string; value: unknown };

/** True when two rules have semantically equivalent conditions (set-based, order-free). */
export function conditionsMatch(
  existingConditions: unknown[],
  existingConditionsOp: string | undefined,
  newConditions: RuleCondition[],
  newConditionsOp: string,
): boolean {
  if ((existingConditionsOp || 'and') !== newConditionsOp) return false;
  if (!Array.isArray(existingConditions)) return false;
  if (existingConditions.length !== newConditions.length) return false;

  const existingSet = new Set(
    existingConditions.map((c: unknown) => {
      const cond = c as Record<string, unknown>;
      return canonicalize({ field: cond.field, op: cond.op, value: cond.value });
    }),
  );
  const newSet = new Set(
    newConditions.map((c) => canonicalize({ field: c.field, op: c.op, value: c.value })),
  );

  if (existingSet.size !== newSet.size) return false;
  for (const item of newSet) {
    if (!existingSet.has(item)) return false;
  }
  return true;
}

/**
 * Find the rule an upsert should update, or null to create a new one.
 * Returns the FIRST match, which is the pre-existing behaviour.
 */
export function findMatchingRule(
  existingRules: unknown[],
  newConditions: RuleCondition[],
  newConditionsOp: string,
): (Record<string, unknown> & { id: string }) | null {
  if (!Array.isArray(existingRules)) return null;
  for (const rule of existingRules) {
    const r = rule as Record<string, unknown>;
    if (!r?.id || typeof r.id !== 'string') continue;
    const existingConditions = Array.isArray(r.conditions) ? r.conditions : [];
    const existingConditionsOp = (r.conditionsOp as string) || 'and';
    if (conditionsMatch(existingConditions, existingConditionsOp, newConditions, newConditionsOp)) {
      return r as Record<string, unknown> & { id: string };
    }
  }
  return null;
}
