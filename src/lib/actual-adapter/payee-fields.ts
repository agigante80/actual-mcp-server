/**
 * #743: the payee fields of a transaction UPDATE.
 *
 * Upstream's `api/transaction-update` never runs `normalizeTransactions`, the only place a
 * `payee_name` is resolved, so on update a `payee_name` key reached the database layer and threw,
 * and a NAME in `payee` was stored as if it were an id (the call succeeded and the transaction
 * read back with no payee). The adapter therefore resolves the name itself, mirroring create:
 * the trimmed name matched case-insensitively against the non-transfer payees, else a new payee.
 *
 * This module is PURE (no api import) so it can be unit-tested without a session. The adapter
 * owns the impure half: reading the listing and creating the payee, as the LAST step before the
 * raw write, so a refusal never leaves a created payee behind.
 */

import { OutOfRangeRefusal } from '../errors.js';
import { isEntityId } from './filter-ids.js';

/** A row of the payees listing, narrowed to what name resolution needs. */
export interface PayeeListingRow {
  id: string;
  name?: string | null;
  transfer_acct?: string | null;
}

const ECHO_MAX = 80;

/**
 * Refuse the ambiguous or invalid payee inputs of an update. Synchronous and read-free, so it can
 * run before anything else. Order matters: both-present first, then the name, then the id.
 */
export function assertPayeeFields(fields: unknown): void {
  if (fields === null || typeof fields !== 'object') return;
  const f = fields as { payee?: unknown; payee_name?: unknown };
  const hasPayee = f.payee !== undefined;
  const hasName = f.payee_name !== undefined;
  if (hasPayee && hasName) {
    throw new OutOfRangeRefusal(
      'payee and payee_name cannot be used together. Pass payee (an id, or null to clear) or payee_name (a name to match or create), not both.',
      'payee_name'
    );
  }
  if (hasName && (typeof f.payee_name !== 'string' || f.payee_name.trim() === '')) {
    throw new OutOfRangeRefusal(
      'payee_name must be a non-empty name. To clear the payee pass payee: null.',
      String(f.payee_name)
    );
  }
  if (typeof f.payee === 'string' && !isEntityId(f.payee)) {
    const shown = f.payee.length > ECHO_MAX ? `${f.payee.slice(0, ECHO_MAX)}...` : f.payee;
    throw new OutOfRangeRefusal(
      `payee must be a payee id. Got "${shown}". To set a payee by name pass payee_name; actual_payees_get lists payees.`,
      f.payee.slice(0, ECHO_MAX)
    );
  }
}

/**
 * The non-transfer payees a name resolves to, exactly as upstream's `getPayeeByName` filters:
 * the trimmed name lower-cased against the stored name lower-cased but NOT trimmed, transfer
 * payees skipped because the listing shows them under their account's name.
 */
export function matchingPayees(name: string, listing: ReadonlyArray<PayeeListingRow>): PayeeListingRow[] {
  const key = name.trim().toLowerCase();
  return listing.filter((r) => !r.transfer_acct && typeof r.name === 'string' && r.name.toLowerCase() === key);
}

/**
 * The refusal for a name that matches two or more payees.
 *
 * Class decision (#752, shared by update, create and import): `OutOfRangeRefusal` with field
 * `payee_name` and the trimmed name as value, NOT a dedicated ambiguity class. It is already typed
 * (`isPreflightRefusal`), already mapped by `categorizeError`, and the candidate ids fit the
 * message. A dedicated class earns its place only if a caller needs the candidates as structure
 * rather than text; #801 reached the same conclusion for the name-to-id lookup.
 */
export function ambiguousPayeeNameRefusal(name: string, matches: ReadonlyArray<PayeeListingRow>): OutOfRangeRefusal {
  const trimmed = name.trim();
  return new OutOfRangeRefusal(
    `Payee name "${trimmed}" matches ${matches.length} payees, so it does not identify one: ${matches.map((m) => m.id).join(', ')}. Nothing was written. Pass payee (the id you mean) instead of payee_name; actual_payees_get lists them.`,
    trimmed
  );
}

/**
 * The distinct (case-insensitively) trimmed non-blank `payee_name` strings of the rows that
 * upstream's `normalizeTransactions` would resolve: objects whose `payee` is null or absent.
 * Anything else (a non-array, a non-object row, a non-string or blank name, a row that already
 * carries a payee id) contributes nothing.
 */
export function payeeNamesToResolve(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue;
    const row = r as { payee?: unknown; payee_name?: unknown };
    if (row.payee != null || typeof row.payee_name !== 'string') continue;
    const trimmed = row.payee_name.trim();
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()];
}

/** Throw the ambiguity refusal for the first name that two or more non-transfer payees carry. */
export function assertPayeeNamesUnambiguous(names: ReadonlyArray<string>, listing: ReadonlyArray<PayeeListingRow>): void {
  for (const name of names) {
    const matches = matchingPayees(name, listing);
    if (matches.length >= 2) throw ambiguousPayeeNameRefusal(name, matches);
  }
}

/**
 * Resolve a payee name against a listing. One non-transfer match returns its id, none returns the
 * trimmed name to create, two or more is refused (see ambiguousPayeeNameRefusal for the class).
 */
export function resolvePayeeName(name: string, listing: ReadonlyArray<PayeeListingRow>): { id: string } | { create: string } {
  const matches = matchingPayees(name, listing);
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length === 0) return { create: name.trim() };
  throw ambiguousPayeeNameRefusal(name, matches);
}
