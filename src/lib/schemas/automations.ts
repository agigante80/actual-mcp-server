/**
 * Read-side helpers for Actual's experimental budget automations (Goal templates), feature
 * `budget_automations` (ADR 0003 and 0004). Pure: no I/O, no api import. The adapter reads the
 * rows and this module shapes them, so every rule is testable without a server.
 *
 * Stored template amounts are CURRENCY UNITS (`#template 50` is stored as `monthly: 50`).
 * Upstream converts them with `amountToInteger(value, decimalPlaces)` using the budget's
 * `defaultCurrencyCode`; this module does the same so the output is integer minor units.
 *
 * The write side (#842) is at the end of this file: the strict editor-form schema a caller may
 * save, the rules that span entries, and the conversion to the stored form.
 */
import { z } from 'zod';
import { CommonSchemas } from './common.js';

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
  /**
   * The budget's schedules, given only when a stored `schedule` entry should be checked (#847).
   * Absent means no check, so a `schedule` entry is returned exactly as stored.
   */
  schedules?: ReadonlyArray<{ id?: unknown; name?: unknown; tombstone?: unknown }>;
}

/**
 * Would upstream's apply find this stored `schedule` entry (#847)? Mirrors the existence check in
 * upstream category-template-context.ts (@actual-app/api 26.11.0): the live schedules are those
 * with a name and no tombstone; an entry with `scheduleId` needs a live schedule with that id
 * (the id wins over the name), and a name-only entry needs one whose trimmed name equals its
 * trimmed name, case sensitive. Anything else throws there and that apply budgets nothing.
 */
export function scheduleEntryResolves(entry: Entry, schedules: NonNullable<CategoryAutomationsRows['schedules']>): boolean {
  // NOT NULL is upstream's whole test (getActiveSchedules): a blank name is live and an id entry
  // on it applies, so it is not marked here even though the save refuses it (PR 853 review).
  const live = schedules.filter((s) => !s?.tombstone && typeof s?.name === 'string');
  if (typeof entry.scheduleId === 'string' && entry.scheduleId !== '') return live.some((s) => s.id === entry.scheduleId);
  if (typeof entry.name !== 'string' || entry.name.trim() === '') return false;
  // Upstream's existence check trims both sides, but its lookup (schedule-template.ts) runs
  // TRIM(name) = ? with the stored name UNTRIMMED, so a padded stored name fails the apply:
  // compare the live name trimmed against the stored name as it is.
  const wanted = entry.name;
  return live.some((s) => (s.name as string).trim() === wanted);
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
        const entry = convertEntry(item, decimalPlaces, rows.categoryNames);
        if (type === 'schedule' && rows.schedules && !scheduleEntryResolves(entry, rows.schedules)) entry.scheduleMissing = true;
        automations.push(entry);
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

// ---------------------------------------------------------------------------------------------
// Write side (#842). The published tool schema is a LIGHT one (type only, passthrough) to stay
// under the per-tool byte ceiling; the tool and the compact action run THIS schema inside a
// superRefine, and the adapter parses again so a direct call cannot skip it. Amounts here are
// integer minor units; toStoredAutomations converts them to the currency units upstream stores.
// ---------------------------------------------------------------------------------------------

export const AUTOMATION_TYPES = ['periodic', 'limit', 'refill', 'percentage', 'average', 'by', 'remainder', 'goal', 'schedule'] as const;

/** The two non-id sources a percentage may name; upstream applies both. */
export const PERCENTAGE_SOURCES: readonly string[] = ['all income', 'available funds'];

const minor = CommonSchemas.budgetAmountCents.min(0, 'amount must be at least 0');
const priority = z.number().int().min(0).max(1000).default(1);
/** limit and remainder store `priority: null`; the read side returns it as stored, so only null is accepted back. */
const nullPriority = z.null().optional();
const description = z.string().max(1000).optional();
const templateDirective = z.literal('template').optional();
/**
 * Upstream walks from a stored date to the budget month one period at a time on every apply, so a
 * year far in the past (0001) would block the event loop on each later apply. Pinned by tests.
 */
export const AUTOMATION_YEAR_MESSAGE = 'the year must be between 1970 and 2199.';
const yearInRange = (v: string): boolean => !/^\d{4}/.test(v) || (Number(v.slice(0, 4)) >= 1970 && Number(v.slice(0, 4)) <= 2199);
const boundedDate = CommonSchemas.date.refine(yearInRange, AUTOMATION_YEAR_MESSAGE).describe('Date in YYYY-MM-DD format, year 1970 to 2199');
const boundedMonth = CommonSchemas.monthYear.refine(yearInRange, AUTOMATION_YEAR_MESSAGE).describe('Month in YYYY-MM format, year 1970 to 2199');

const periodic = z.strictObject({
  type: z.literal('periodic'),
  directive: templateDirective,
  amount: minor,
  period: z.strictObject({ period: z.enum(['day', 'week', 'month', 'year']), amount: z.number().int().min(1).max(1000) }),
  starting: boundedDate,
  priority,
  description,
});
const limit = z.strictObject({
  type: z.literal('limit'),
  directive: templateDirective,
  amount: minor,
  period: z.enum(['daily', 'weekly', 'monthly']),
  hold: z.boolean().default(false),
  start: boundedDate.optional(),
  priority: nullPriority,
  description,
}).superRefine((v, ctx) => {
  if (v.period === 'weekly' && v.start === undefined) ctx.addIssue({ code: 'custom', message: 'a weekly limit needs start (YYYY-MM-DD).' });
});
const refill = z.strictObject({ type: z.literal('refill'), directive: templateDirective, priority, description });
const percentage = z.strictObject({
  type: z.literal('percentage'),
  directive: templateDirective,
  percent: z.number().gt(0).max(100),
  previous: z.boolean().default(false),
  category: z.union([z.literal('all income'), z.literal('available funds'), CommonSchemas.categoryId]),
  priority,
  description,
  /** Added by the read side; accepted and dropped so a read result can be sent back. */
  categoryName: z.string().optional(),
});
const average = z.strictObject({ type: z.literal('average'), directive: templateDirective, numMonths: z.number().int().min(1).max(120), priority, description });
const by = z.strictObject({
  type: z.literal('by'),
  directive: templateDirective,
  amount: minor,
  month: boundedMonth,
  annual: z.boolean().default(false),
  repeat: z.number().int().min(1).max(1200).optional(),
  priority,
  description,
});
const remainder = z.strictObject({ type: z.literal('remainder'), directive: templateDirective, weight: z.number().int().min(1).max(1000), priority: nullPriority, description });
const goal = z.strictObject({ type: z.literal('goal'), directive: z.literal('goal').optional(), amount: minor, description });
const schedule = z.strictObject({
  type: z.literal('schedule'),
  directive: templateDirective,
  scheduleId: CommonSchemas.scheduleId.optional(),
  name: z.string().min(1).optional(),
  priority,
  description,
  // The read's marker (#847), accepted so a read result can be saved back, and never stored.
  scheduleMissing: z.boolean().optional(),
}).superRefine((v, ctx) => {
  // Both are accepted (a read of an entry this server saved carries both); the id then wins.
  if (v.scheduleId === undefined && v.name === undefined) ctx.addIssue({ code: 'custom', message: 'give scheduleId or name.' });
});

export const EDITOR_AUTOMATION = z.discriminatedUnion('type', [periodic, limit, refill, percentage, average, by, remainder, goal, schedule]);
export type EditorAutomation = z.infer<typeof EDITOR_AUTOMATION>;

/** Pinned by tests. */
export const COMBINATION_MESSAGES = {
  oneLimit: 'only one limit is allowed per category.',
  oneGoal: 'only one goal is allowed per category.',
  refillNeedsLimit: 'refill needs a limit in the same list.',
  percentOver: 'percentages of one income source total more than 100.',
  sharedPriority: 'schedule and by entries must share one priority.',
} as const;

/** The whole list: at most 50 entries, each strict, and the rules that span entries. */
export const EDITOR_AUTOMATIONS = z.array(EDITOR_AUTOMATION).max(50).superRefine((list, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const count = (type: string) => list.filter((e) => e.type === type).length;
  if (count('limit') > 1) issue(COMBINATION_MESSAGES.oneLimit);
  if (count('goal') > 1) issue(COMBINATION_MESSAGES.oneGoal);
  if (count('refill') > 0 && count('limit') === 0) issue(COMBINATION_MESSAGES.refillNeedsLimit);
  const totals = new Map<string, number>();
  for (const e of list) if (e.type === 'percentage') totals.set(e.category, (totals.get(e.category) ?? 0) + e.percent);
  if ([...totals.values()].some((t) => t > 100)) issue(COMBINATION_MESSAGES.percentOver);
  const shared = new Set<number>();
  for (const e of list) if (e.type === 'schedule' || e.type === 'by') shared.add(e.priority);
  if (shared.size > 1) issue(COMBINATION_MESSAGES.sharedPriority);
});

/** Parse a caller list (throws ZodError, paths relative to the list). The input is never mutated. */
export function parseEditorAutomations(input: unknown): EditorAutomation[] {
  return EDITOR_AUTOMATIONS.parse(input);
}

/** Minor units to the currency units upstream stores: 5000 USD cents is 50, 5000 JPY is 5000. */
export function toStoredUnits(minorAmount: number, currencyCode: unknown): number {
  return minorAmount / 10 ** currencyDecimalPlaces(currencyCode);
}

/**
 * The stored form of validated entries. `directive` is set here (upstream ignores an entry
 * without it), money is in currency units, a schedule is stored by its id AND its name
 * (`scheduleRefs` maps the list index to the live schedule; upstream looks the id up first, so a
 * rename does not break it, and prints the name), `categoryName` and `scheduleMissing` are
 * dropped, and limit and remainder carry `priority: null`. Returns new objects.
 */
export function toStoredAutomations(
  list: readonly EditorAutomation[],
  currencyCode: unknown,
  scheduleRefs: ReadonlyMap<number, { id: string; name: string }> = new Map(),
): Array<Record<string, unknown>> {
  return list.map((entry, index) => {
    const { type, directive: _directive, description: text, ...rest } = entry as Entry & { type: string };
    const head = { type, directive: type === 'goal' ? 'goal' : 'template' };
    const tail = text !== undefined ? { description: text } : {};
    if (type === 'schedule') {
      const ref = scheduleRefs.get(index);
      const ids = ref ? { scheduleId: ref.id, name: ref.name } : { ...(rest.scheduleId !== undefined ? { scheduleId: rest.scheduleId } : {}), name: rest.name };
      return { ...head, ...ids, priority: rest.priority, ...tail };
    }
    const { categoryName: _categoryName, priority: _priority, ...fields } = rest;
    if (typeof fields.amount === 'number') fields.amount = toStoredUnits(fields.amount, currencyCode);
    const stored = type === 'limit' || type === 'remainder' ? { priority: null } : type === 'goal' ? {} : { priority: _priority };
    return { ...head, ...fields, ...stored, ...tail };
  });
}
