/**
 * Read-side helpers for Actual's experimental budget automations (Goal templates), feature
 * `budget_automations` (ADR 0003 and 0004). Pure: no I/O, no api import. The adapter reads the
 * rows and this module shapes them, so every rule is testable without a server.
 *
 * Stored template amounts are CURRENCY UNITS (`#template 50` is stored as `monthly: 50`).
 * Upstream converts them with `amountToInteger(value, decimalPlaces)` using the budget's
 * `defaultCurrencyCode`; this module does the same so the output is integer minor units.
 */

/**
 * The only currencies with 0 decimal places in `@actual-app/api` 26.11.0 (its bundled table
 * has 55 entries, every other one has 2). `Intl.NumberFormat` must not replace this list: it
 * gives 0 places for HUF, CLP, COP, IDR and PKR where upstream uses 2, a 100x error.
 * scripts/check-experimental-surface.mjs reports a finding when upstream's table changes.
 */
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ['IRR', 'JPY', 'KRW'];

/** Decimal places upstream uses for a currency code: 0 for the three above, 2 for anything else (null, empty and unknown included). */
export function currencyDecimalPlaces(code: unknown): number {
  return typeof code === 'string' && ZERO_DECIMAL_CURRENCIES.includes(code) ? 0 : 2;
}

/** Same rounding as upstream's amountToInteger. */
function toMinorUnits(value: number, decimalPlaces: number): number {
  return Math.round(value * 10 ** decimalPlaces);
}

/**
 * Template types the server knows. Anything else, and the stored `error` type, is reported in
 * `errors` and never converted as money. `simple`, `spend` and `copy` are produced by notes
 * only; the editor writes the rest.
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'periodic', 'limit', 'refill', 'percentage', 'average', 'by', 'remainder', 'goal', 'schedule', 'simple', 'spend', 'copy',
]);

export interface AutomationError {
  type: string;
  line?: string;
  error?: string;
}

export interface CleanupEntry {
  role: unknown;
  groupId: unknown;
  weight?: unknown;
  groupName?: string;
}

type Entry = Record<string, unknown>;

const isObject = (v: unknown): v is Entry => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Convert the money fields of one KNOWN template entry; every other field is returned as stored. */
function convertEntry(entry: Entry, decimalPlaces: number, categoryNames: ReadonlyMap<string, string>): Entry {
  const out: Entry = { ...entry };
  if (isNumber(out.amount)) out.amount = toMinorUnits(out.amount, decimalPlaces);
  if (isNumber(out.monthly)) out.monthly = toMinorUnits(out.monthly, decimalPlaces);
  if (isObject(out.limit) && isNumber(out.limit.amount)) {
    out.limit = { ...out.limit, amount: toMinorUnits(out.limit.amount, decimalPlaces) };
  }
  // An adjustment is money only when it is a fixed amount; a percent adjustment is a percentage.
  if (out.adjustmentType === 'fixed' && isNumber(out.adjustment)) out.adjustment = toMinorUnits(out.adjustment, decimalPlaces);
  // A percentage names its income category by id (editor), by name (note) or as `all income`: return it as stored.
  if (out.type === 'percentage' && typeof out.category === 'string') {
    const name = categoryNames.get(out.category);
    if (name !== undefined) out.categoryName = name;
  }
  return out;
}

/** Parse a stored JSON column. `parsed` is undefined for null or empty, `bad` is true when it was present but unparsable. */
export function parseJsonColumn(raw: unknown): { parsed: unknown; bad: boolean } {
  if (raw === null || raw === undefined || raw === '') return { parsed: undefined, bad: false };
  if (typeof raw !== 'string') return { parsed: raw, bad: false };
  try {
    return { parsed: JSON.parse(raw), bad: false };
  } catch {
    return { parsed: undefined, bad: true };
  }
}

/** Whether `template_settings` says the editor manages the category. Unset or unparsable means notes. */
export function templateSource(templateSettings: unknown): 'ui' | 'notes' {
  const { parsed } = parseJsonColumn(templateSettings);
  return isObject(parsed) && parsed.source === 'ui' ? 'ui' : 'notes';
}

/**
 * The directive lines of a category note, as upstream extracts them: for `#template` and
 * `#goal` the substring from the first `#` of a line, trimmed, when it starts with `#template`
 * or `#goal` (case sensitive); for cleanup the whole trimmed line when its lowercase form
 * starts with `#cleanup `. No note, or no directive line, gives an empty list.
 */
export function parseNoteDirectives(note: string | null | undefined): string[] {
  if (!note) return [];
  const out: string[] = [];
  for (const line of note.split('\n')) {
    const hash = line.indexOf('#');
    if (hash !== -1) {
      const directive = line.substring(hash).trim();
      if (directive.startsWith('#template') || directive.startsWith('#goal')) {
        out.push(directive);
        continue;
      }
    }
    const whole = line.trim();
    if (whole.toLowerCase().startsWith('#cleanup ')) out.push(whole);
  }
  return out;
}

export interface CategoryAutomationsRows {
  categoryId: string;
  /** The categories row's raw `template_settings` (an object, or a JSON string). */
  templateSettings: unknown;
  /** Raw `goal_def` and `cleanup_def` JSON strings, null when never stored. */
  goalDef: unknown;
  cleanupDef: unknown;
  /** The category note, null when none. Only used for a note-managed category. */
  note: string | null;
  /** Value of the `defaultCurrencyCode` preference. */
  currencyCode: unknown;
  cleanupGroupNames: ReadonlyMap<string, string>;
  categoryNames: ReadonlyMap<string, string>;
}

export interface EditorAutomations {
  categoryId: string;
  source: 'ui';
  automations: Entry[];
  errors: AutomationError[];
  cleanup: CleanupEntry[];
}

export interface NoteAutomations {
  categoryId: string;
  source: 'notes';
  noteDirectives: string[];
  cleanup: CleanupEntry[];
  /** Present only when a stored column could not be read. */
  errors?: AutomationError[];
}

function shapeCleanup(rows: CategoryAutomationsRows, errors: AutomationError[]): CleanupEntry[] {
  const { parsed, bad } = parseJsonColumn(rows.cleanupDef);
  if (bad) {
    errors.push({ type: 'cleanup_def', error: 'cleanup_def is not valid JSON' });
    return [];
  }
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    errors.push({ type: 'cleanup_def', error: 'cleanup_def is not a list' });
    return [];
  }
  const out: CleanupEntry[] = [];
  for (const item of parsed) {
    if (!isObject(item)) {
      errors.push({ type: 'cleanup_def', error: 'cleanup_def holds an entry that is not an object' });
      continue;
    }
    const entry: CleanupEntry = { role: item.role, groupId: item.groupId ?? null };
    if (item.weight !== undefined) entry.weight = item.weight;
    if (typeof item.groupId === 'string') {
      const name = rows.cleanupGroupNames.get(item.groupId);
      if (name !== undefined) entry.groupName = name;
    }
    out.push(entry);
  }
  return out;
}

/** Shape one category's rows into the tool result. Never throws on stored content. */
export function shapeCategoryAutomations(rows: CategoryAutomationsRows): EditorAutomations | NoteAutomations {
  const errors: AutomationError[] = [];
  const cleanup = shapeCleanup(rows, errors);
  if (templateSource(rows.templateSettings) === 'notes') {
    // goal_def of a note-managed category is stale (null until an apply runs), so the directives
    // come from the note and goal_def is never returned for it.
    return {
      categoryId: rows.categoryId,
      source: 'notes',
      noteDirectives: parseNoteDirectives(rows.note),
      cleanup,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  const decimalPlaces = currencyDecimalPlaces(rows.currencyCode);
  const automations: Entry[] = [];
  const { parsed, bad } = parseJsonColumn(rows.goalDef);
  if (bad) errors.push({ type: 'goal_def', error: 'goal_def is not valid JSON' });
  else if (parsed !== undefined && !Array.isArray(parsed)) errors.push({ type: 'goal_def', error: 'goal_def is not a list' });
  else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const type = isObject(item) && typeof item.type === 'string' ? item.type : undefined;
      if (isObject(item) && type !== undefined && KNOWN_TYPES.has(type)) {
        automations.push(convertEntry(item, decimalPlaces, rows.categoryNames));
        continue;
      }
      const err: AutomationError = { type: type ?? 'unknown' };
      if (isObject(item)) {
        if (typeof item.line === 'string') err.line = item.line;
        if (typeof item.error === 'string') err.error = item.error;
      }
      errors.push(err);
    }
  }
  return { categoryId: rows.categoryId, source: 'ui', automations, errors, cleanup };
}
