import { postingRows } from './financial-analysis.js';

// The search tools hold rows typed loosely (the adapter's Transaction schema, or any); the helper
// takes and returns them as they come. The analysis row type has no `notes`; a search row has it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SearchRow = any;

/**
 * #750: Actual returns a split as ONE grouped parent row (category null) with its children nested
 * in `subtransactions`. A search that filters on category or notes must look at the children, or
 * it never sees the money that was categorised. This replaces every split parent by its children
 * (the same rule `summarize_transactions` and `run_query` apply) so every filter the caller's tool
 * runs afterwards sees the child.
 *
 * A plain row passes through unchanged. A child that also arrives top-level is not duplicated.
 * `parentNotes` maps each child id to its parent's notes, read BEFORE flattening, so a notes search
 * that matched the parent's notes keeps finding the split (see `childNotesMatch`).
 */
export function expandSplitsForSearch(
  transactions: SearchRow[],
): { rows: SearchRow[]; parentNotes: Map<string, string | null> } {
  const parentNotes = new Map<string, string | null>();
  for (const transaction of transactions) {
    if (transaction.is_parent === true || (transaction.subtransactions?.length ?? 0) > 0) {
      for (const child of transaction.subtransactions ?? []) {
        parentNotes.set(child.id, transaction.notes ?? null);
      }
    }
  }
  return { rows: postingRows(transactions) as SearchRow[], parentNotes };
}

/**
 * Case-insensitive notes match for an expanded row: the term is in the row's own notes OR in its
 * split parent's notes (matching only; the returned row still shows its own notes). Matching the
 * parent's notes for EVERY child, not only those with no notes, keeps a search for the split's
 * notes returning the whole split (a partial split would understate the total with nothing
 * marking it partial). A row that is not a split child uses its own notes.
 */
export function childNotesMatch(
  row: SearchRow,
  parentNotes: Map<string, string | null>,
  term: string,
): boolean {
  const needle = term.toLowerCase();
  return [row.notes, parentNotes.get(row.id)].some((text) => (text || '').toLowerCase().includes(needle));
}
