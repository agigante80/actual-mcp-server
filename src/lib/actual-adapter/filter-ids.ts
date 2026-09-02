/**
 * #388: what an OPTIONAL FILTER id means when the caller passes a NAME.
 *
 * The surface used to answer that question three different ways, and the inconsistency was the
 * real defect rather than the schema question that surfaced it:
 *
 *   1. `transactions_search_by_amount` DETECTED the name, looked it up, and answered with the
 *      correct UUID. Strictly the most useful thing any of them did.
 *   2. `transactions_get` pre-flighted and returned `notFoundMsg`, naming the entity and the
 *      listing tool but not resolving the name.
 *   3. Everything else silently returned an EMPTY result set, which is the worst of the three:
 *      a plausible-looking wrong answer that reads as "no transactions match".
 *
 * #380 swept the REQUIRED lookup ids onto `CommonSchemas` and deliberately left these behind,
 * because tightening them is a contract decision rather than a sweep. Tightening alone (making
 * the schema reject a non-UUID) would have deleted accommodation 1, trading the best message on
 * the surface for a ZodError. So the schema stays a bare string and the answer moves here.
 *
 * THE FAST PATH READS NOTHING. A value that is already a UUID is returned untouched, without a
 * listing call, so a correct call costs exactly what it costs today. The listing read happens
 * only on the unhappy path, where the caller has already made a mistake and the alternative is
 * a wrong answer.
 *
 * This module is deliberately PURE so it can be unit-tested without an api session; the adapter
 * owns the impure half (fetching the listing) because that is where a listing read gets `retry`
 * and the observability call site, and because #371 and #376 concluded that a check the tools
 * share belongs in the adapter rather than copied into ten tool files.
 */

import { UUID_PATTERN } from '../constants.js';

/** The entity kinds that can appear as an optional filter id. */
export type FilterIdKind = 'account' | 'category' | 'payee';

/** A row from one of the three listings, narrowed to what name matching needs. */
export interface NamedRow {
  id?: string | null;
  name?: string | null;
}

/** Human-readable entity name and the tool that lists it, for the refusal message. */
export const FILTER_ID_ENTITIES: Record<FilterIdKind, { entity: string; listTool: string }> = {
  account: { entity: 'Account', listTool: 'actual_accounts_list' },
  category: { entity: 'Category', listTool: 'actual_categories_get' },
  payee: { entity: 'Payee', listTool: 'actual_payees_get' },
};

/**
 * Is this value already a well-formed entity id?
 *
 * When it is, NOTHING else in this module runs: the value is handed straight back and no
 * listing is read. That is what keeps the change free for every correct call, and it is also
 * why a non-existent but well-formed UUID still behaves exactly as it does today (an empty
 * result). Checking existence would mean a listing read on EVERY call, which is a cost this
 * ticket explicitly declined to impose to fix a mistake nobody makes: the failure being fixed
 * is a name passed where an id belongs, not a mistyped UUID.
 */
export function isEntityId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Find the row whose NAME is what the caller passed.
 *
 * Case-insensitive and trimmed, matching the accommodation this generalises. Returns undefined
 * rather than throwing so the caller decides between "resolved" and "no such name", which are
 * two different messages.
 *
 * Ambiguity is resolved by taking the FIRST match, deliberately. Actual permits two categories
 * with the same name in different groups, so a name is not a key. Reporting the first is still
 * strictly better than the empty result set this replaces, and the message names the id it
 * chose, so a caller who meant the other one can see that it is not theirs.
 */
export function matchByName<T extends NamedRow>(rows: readonly T[], value: string): T | undefined {
  const wanted = value.trim().toLowerCase();
  if (wanted === '') return undefined;
  return rows.find((r) => typeof r.name === 'string' && r.name.trim().toLowerCase() === wanted);
}

/**
 * The refusal text for a name that DID resolve.
 *
 * It names the id rather than silently substituting it. Substituting would be friendlier for
 * one call and wrong as a contract: the caller's next call would still pass the name, and a
 * server that quietly accepts names has no way to report the ambiguity above.
 */
export function resolvedNameDetail(kind: FilterIdKind, name: string, id: string): string {
  const { entity, listTool } = FILTER_ID_ENTITIES[kind];
  const noun = entity.toLowerCase();
  // The article matters here only because getting it wrong ("a account") reads as a bug in the
  // server to the person who hits this, and this string is the one they see.
  const article = /^[aeiou]/.test(noun) ? 'an' : 'a';
  // The ANSWER comes first, deliberately. The generic not-found prefix would otherwise put "use
  // the listing tool" ahead of the id we already resolved, and that is the instruction a model
  // follows.
  return (
    `"${name}" is ${article} ${noun} NAME, not an id. Use "${id}" instead ` +
    `(${listTool} lists them if that is not the ${noun} you meant).`
  );
}
