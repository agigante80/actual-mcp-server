import { OutOfRangeRefusal } from '../errors.js';

/**
 * Pure helpers for the budget template writes (#841, experimental feature budget_automations):
 * apply Goal templates and end of month cleanup. The adapter reads and sends; nothing here
 * touches the api. Texts that a test pins live here as constants.
 */

/** The synced preference that turns the note-based Goal templates on. Upstream does not enforce it. */
export const GOAL_TEMPLATES_FLAG = 'flags.goalTemplatesEnabled';

export const GOAL_TEMPLATES_DISABLED_MESSAGE =
  'Goal templates are not enabled in this budget. In Actual, turn on Settings > Experimental features > Goal templates, then retry. Nothing was changed.';

export const TRACKING_BUDGET_MESSAGE =
  'Budget templates and cleanup need an envelope budget; this budget is a tracking budget. Nothing was changed.';

export const TEMPLATE_CHECK_FAILED_HEADER =
  'Template check failed, nothing was changed. Fix these category notes in Actual, then retry:';

/**
 * Synced preferences are strings. Only the exact stored text "true" is on: a stored "false", an
 * absent row and any other value are all off, so a budget that never turned the feature on is refused.
 */
export function isFlagOn(value: unknown): boolean {
  return value === 'true';
}

/**
 * The month must be one the budget has. Shared by setBudgetAmount (#361) and the template writes:
 * upstream's own month validation differs per handler, so the adapter checks membership itself.
 * An empty or non-array listing cannot prove a month is out of range, so it passes.
 */
export function assertMonthInRange(months: unknown, month: unknown): void {
  if (Array.isArray(months) && months.length > 0 && !months.includes(String(month))) {
    throw new OutOfRangeRefusal(
      `Month "${month}" is outside this budget's range, which runs from ${months[0]} to ` +
        `${months[months.length - 1]}. Use actual_budgets_get_months to see the months you can budget to.`,
      String(month),
    );
  }
}

/** The upstream replies the adapter knows, by send. Anything else is logged and the after-read decides. */
export const KNOWN_APPLY_REPLIES: ReadonlySet<string> = new Set(['templates-applied', 'templates-up-to-date']);
export const KNOWN_CLEANUP_REPLIES: ReadonlySet<string> = new Set([
  'cleanup-applied',
  'cleanup-up-to-date',
  'cleanup-applied-with-errors',
  'cleanup-no-funds',
]);

export interface UpstreamReply {
  message?: string;
  pre?: string;
}

/** Reads the two fields the adapter uses out of whatever upstream replied; never throws. */
export function readReply(reply: unknown): UpstreamReply {
  if (typeof reply !== 'object' || reply === null) return {};
  const { message, pre } = reply as { message?: unknown; pre?: unknown };
  return {
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof pre === 'string' ? { pre } : {}),
  };
}

/** The entries of a `template-errors` reply: upstream joins them with a blank line. */
export function splitCheckEntries(pre: string | undefined): string[] {
  return (pre ?? '').split('\n\n').filter((entry) => entry !== '');
}

/**
 * The entries that should refuse. Month-wide apply: every entry. Single-category apply: only those
 * that start with `<category name>: ` (a same-named category is included, which is accepted).
 */
export function matchingCheckEntries(pre: string | undefined, categoryName?: string): string[] {
  const entries = splitCheckEntries(pre);
  if (categoryName === undefined) return entries;
  return entries.filter((entry) => entry.startsWith(`${categoryName}: `));
}

export function templateCheckMessage(entries: readonly string[]): string {
  return `${TEMPLATE_CHECK_FAILED_HEADER}\n${entries.join('\n\n')}`;
}

export interface MonthCategoryRow {
  id: string;
  name: string;
  budgeted: number;
}

/** Every category of a budget month with its budgeted amount, in the month's own order. */
export function monthCategoryRows(budgetMonth: unknown): MonthCategoryRow[] {
  const groups = (budgetMonth as { categoryGroups?: unknown } | null | undefined)?.categoryGroups;
  if (!Array.isArray(groups)) return [];
  const rows: MonthCategoryRow[] = [];
  for (const group of groups) {
    const categories = (group as { categories?: unknown } | null)?.categories;
    if (!Array.isArray(categories)) continue;
    for (const c of categories) {
      const { id, name, budgeted } = (c ?? {}) as { id?: unknown; name?: unknown; budgeted?: unknown };
      if (typeof id !== 'string') continue;
      rows.push({ id, name: typeof name === 'string' ? name : id, budgeted: typeof budgeted === 'number' ? budgeted : 0 });
    }
  }
  return rows;
}

export interface BudgetChange {
  categoryId: string;
  name: string;
  before: number;
  after: number;
}

const byNameThenId = (a: BudgetChange, b: BudgetChange): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0;

/**
 * The categories whose budgeted amount differs between two reads of the same month, sorted by name.
 * This is the only source of a result: upstream's reply and its `count` do not say what was written.
 */
export function diffMonthRows(before: readonly MonthCategoryRow[], after: readonly MonthCategoryRow[]): BudgetChange[] {
  const was = new Map(before.map((r) => [r.id, r.budgeted]));
  const changes: BudgetChange[] = [];
  for (const row of after) {
    const previous = was.get(row.id) ?? 0;
    if (previous !== row.budgeted) changes.push({ categoryId: row.id, name: row.name, before: previous, after: row.budgeted });
  }
  return changes.sort(byNameThenId);
}

export interface SettleTiming {
  /** Read every this many ms. */
  intervalMs: number;
  /** Do not call a month settled before this much time has passed since the send resolved. */
  floorMs: number;
  /** Stop waiting after this long and report the last read as not verified. */
  boundMs: number;
}

/** #493 measured a raw write visible 170 to 400 ms late inside a drain, hence the floor. */
export const DEFAULT_SETTLE: Readonly<SettleTiming> = Object.freeze({ intervalMs: 100, floorMs: 500, boundMs: 3000 });

const sameRows = (a: readonly MonthCategoryRow[], b: readonly MonthCategoryRow[]): boolean =>
  a.length === b.length && a.every((row, i) => row.id === b[i]!.id && row.budgeted === b[i]!.budgeted);

const realClock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

/**
 * Read the month until two consecutive reads are equal AND the floor has passed, bounded by
 * `boundMs` and by `deadline` (an absolute time, 0 for none). Returns the last read and whether it
 * settled. A read that throws propagates: a half-known result is not reported as a change list.
 */
export async function readUntilSettled(
  read: () => Promise<MonthCategoryRow[]>,
  timing: SettleTiming,
  deadline: number,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = realClock,
): Promise<{ rows: MonthCategoryRow[]; settled: boolean }> {
  const startedAt = clock.now();
  const stopAt = deadline > 0 ? Math.min(startedAt + timing.boundMs, deadline) : startedAt + timing.boundMs;
  let last = await read();
  for (;;) {
    if (clock.now() >= stopAt) return { rows: last, settled: false };
    await clock.sleep(Math.max(0, Math.min(timing.intervalMs, stopAt - clock.now())));
    const current = await read();
    const equal = sameRows(last, current);
    last = current;
    if (equal && clock.now() - startedAt >= timing.floorMs) return { rows: current, settled: true };
  }
}
