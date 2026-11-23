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

/** Canonical JSON for one object: keys sorted, `undefined` values dropped, a oneOf or notOneOf array sorted. */
export function canonicalize(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] !== undefined) sorted[key] = obj[key];
  }
  // #710: a oneOf or notOneOf value is a SET of ids, so [a, b] and [b, a] are the same
  // condition. Compare a sorted COPY; the stored value is never reordered. Without this an
  // upsert with the ids in another order creates a duplicate rule.
  if ((sorted.op === 'oneOf' || sorted.op === 'notOneOf') && Array.isArray(sorted.value)) {
    sorted.value = [...sorted.value].sort();
  }
  // #711: an isbetween range {num1, num2} matches the same amounts whichever bound comes first
  // (upstream takes the min and max), so the key is built fresh as {num1: min, num2: max}.
  // Again only the comparison key changes, never the stored value.
  const range = sorted.value as { num1?: unknown; num2?: unknown } | null;
  if (sorted.op === 'isbetween' && range && typeof range === 'object' &&
      typeof range.num1 === 'number' && typeof range.num2 === 'number') {
    sorted.value = { num1: Math.min(range.num1, range.num2), num2: Math.max(range.num1, range.num2) };
  }
  // #711: onBudget and offBudget take no value (upstream ignores it), so "" and any other
  // value are the same condition. Without this an upsert that sends a different placeholder
  // creates a second rule matching exactly the same transactions.
  if (sorted.op === 'onBudget' || sorted.op === 'offBudget') sorted.value = '';
  return JSON.stringify(sorted);
}

/**
 * #761: a condition's `options` as part of its identity, normalised: a false flag is dropped, an
 * empty object equals an absent one (canonicalize sorts the keys). Total on a stored value of any shape
 * (upstream keeps `options` on any field), so it never throws.
 */
function normalizeOptions(options: unknown): Record<string, unknown> | undefined {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined;
  const kept = Object.entries(options as Record<string, unknown>).filter(([, v]) => v !== false && v !== undefined);
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

const identity = (c: { field?: unknown; op?: unknown; value?: unknown; options?: unknown }): string =>
  canonicalize({ field: c.field, op: c.op, value: c.value, options: normalizeOptions(c.options) });

export type RuleCondition = { field: string; op: string; value: unknown; options?: unknown };

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
      return identity((c ?? {}) as Record<string, unknown>);
    }),
  );
  const newSet = new Set(
    newConditions.map((c) => identity(c)),
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
