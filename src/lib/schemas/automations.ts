import { z } from 'zod';
import { CommonSchemas } from './common.js';

/**
 * One budget automation, as Actual's automation editor (Budget automations UI) builds it. Every
 * field except `type` (and `scheduleId` for a schedule) is optional and takes the editor's
 * default: priority 1, a $100 monthly fixed amount, 15% of all income, a 3 month average,
 * $1,200 by twelve months from now repeating yearly, remainder weight 1, a $500 monthly limit,
 * a $1,000 goal (desktop-client goals/reducer.ts at v26.11.0). Amounts are integer cents here;
 * Actual stores templates in currency units, so `toTemplate` divides by 100.
 */
const FIELDS = {
  fixed: ['amount', 'period', 'every', 'starting', 'priority'],
  refill: ['priority'],
  percentage: ['percent', 'previous', 'incomeCategory', 'priority'],
  schedule: ['scheduleId', 'full', 'priority'],
  average: ['months', 'priority'],
  copy: ['months', 'priority'],
  by: ['amount', 'month', 'annual', 'repeat', 'priority'],
  remainder: ['weight'],
  limit: ['amount', 'limitPeriod', 'hold', 'starting'],
  goal: ['amount'],
} as const;
type AutomationType = keyof typeof FIELDS;

const positiveInt = z.number().int().positive();

export const AutomationSchema = z
  .object({
    type: z.enum(Object.keys(FIELDS) as [AutomationType, ...AutomationType[]])
      .describe('Kind.'),
    amount: positiveInt.optional().describe('Cents; default fixed 10000, by 120000, limit 50000, goal 100000.'),
    period: z.enum(['day', 'week', 'month', 'year']).optional().describe('fixed: repeat unit, default month.'),
    every: positiveInt.optional().describe('fixed: every N periods, default 1.'),
    starting: CommonSchemas.date.optional().describe('Start date for fixed or weekly limit.'),
    percent: z.number().positive().max(100).optional().describe('percentage: up to 100, default 15.'),
    previous: z.boolean().optional().describe("percentage: last month's income."),
    incomeCategory: z.string().min(1).optional().describe('percentage: "all income" (default), "available funds" or income category id.'),
    scheduleId: CommonSchemas.scheduleId.optional().describe('schedule: required.'),
    full: z.boolean().optional().describe('schedule: all in the due month.'),
    months: positiveInt.optional().describe('average: months; copy: months back. Default 3.'),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').optional().describe('by: target YYYY-MM, default in 12 months.'),
    annual: z.boolean().optional().describe('by: yearly (default) or monthly.'),
    repeat: positiveInt.optional().describe('by: every N, default 1.'),
    weight: positiveInt.optional().describe('remainder: share weight, default 1.'),
    limitPeriod: z.enum(['daily', 'weekly', 'monthly']).optional().describe('limit: default monthly.'),
    hold: z.boolean().optional().describe('limit: keep a balance over it.'),
    priority: z.number().int().min(0).optional().describe('Lowest first; default 1; 0 is never capped.'),
  })
  .strict()
  .superRefine((a, ctx) => {
    const allowed: readonly string[] = FIELDS[a.type];
    for (const key of Object.keys(a)) {
      if (key !== 'type' && !allowed.includes(key)) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is not valid for a ${a.type} automation` });
    }
    if (a.type === 'schedule' && !a.scheduleId) ctx.addIssue({ code: 'custom', path: ['scheduleId'], message: 'scheduleId is required for a schedule automation' });
    if (a.type === 'limit' && a.starting !== undefined && a.limitPeriod !== 'weekly') {
      ctx.addIssue({ code: 'custom', path: ['starting'], message: 'starting is only valid for a weekly limit' });
    }
    if (a.starting !== undefined && !z.iso.date().safeParse(a.starting).success) {
      ctx.addIssue({ code: 'custom', path: ['starting'], message: 'starting must be a valid calendar date in YYYY-MM-DD format' });
    }
  });
export type Automation = z.infer<typeof AutomationSchema>;

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Build the template Actual stores, filling the editor's defaults. `now` is for tests. */
export function toTemplate(a: Automation, now = new Date()): Record<string, unknown> {
  const t = { directive: 'template', priority: a.priority ?? 1 };
  const units = (cents: number) => cents / 100;
  switch (a.type) {
    case 'fixed':
      return { ...t, type: 'periodic', amount: units(a.amount ?? 10000), period: { period: a.period ?? 'month', amount: a.every ?? 1 }, starting: a.starting ?? `${ym(now)}-01` };
    case 'refill':
      return { ...t, type: 'refill' };
    case 'percentage':
      return { ...t, type: 'percentage', percent: a.percent ?? 15, previous: a.previous ?? false, category: a.incomeCategory ?? 'all income' };
    case 'schedule':
      return { ...t, type: 'schedule', scheduleId: a.scheduleId, name: '', ...(a.full === undefined ? {} : { full: a.full }) };
    case 'average':
      return { ...t, type: 'average', numMonths: a.months ?? 3 };
    case 'copy':
      return { ...t, type: 'copy', lookBack: a.months ?? 3 };
    case 'by':
      return { ...t, type: 'by', amount: units(a.amount ?? 120000), month: a.month ?? ym(new Date(now.getFullYear() + 1, now.getMonth(), 1)), annual: a.annual ?? true, repeat: a.repeat ?? 1 };
    case 'remainder':
      return { directive: 'template', type: 'remainder', weight: a.weight ?? 1, priority: null };
    case 'limit':
      return { directive: 'template', type: 'limit', amount: units(a.amount ?? 50000), period: a.limitPeriod ?? 'monthly', hold: a.hold ?? false, priority: null, ...(a.starting && { start: a.starting }) };
    case 'goal':
      return { directive: 'goal', type: 'goal', amount: units(a.amount ?? 100000) };
  }
}

type T = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Turn a category's parsed note templates into automation-editor entries, as the editor does when
 * it opens a category that still uses notes (desktop-client BudgetAutomationsModal and
 * migrateTemplatesToAutomations.ts at v26.11.0): a percentage's income category name becomes its
 * id (pass only income categories, as the editor's picker offers); a schedule gets its id and current name; a `simple` template splits into a limit, a refill
 * (limit only) and a monthly fixed amount; a fixed or remainder template's limit becomes its own
 * limit entry; a `simple` with neither is dropped. Error templates are the caller's to refuse.
 */
export function importNoteTemplates(
  templates: T[],
  schedules: ReadonlyArray<{ id: string; name?: string | null }>,
  incomeCategories: ReadonlyArray<{ id: string; name?: string }>,
  now = new Date(),
): T[] {
  const out: T[] = [];
  const limitEntry = (l: T, extra: T = {}) => ({ type: 'limit', amount: l.amount, hold: l.hold, period: l.period, start: l.start, directive: 'template', priority: null, ...extra });
  for (const raw of templates) {
    let t = raw;
    if (t.type === 'percentage' && t.category) {
      const hit = incomeCategories.find((c) => c.name?.toLowerCase() === String(t.category).toLowerCase());
      if (hit) t = { ...t, category: hit.id };
    }
    if (t.type === 'schedule') {
      const s = t.scheduleId ? schedules.find((x) => x.id === t.scheduleId) : t.name ? schedules.find((x) => x.name?.trim() === t.name.trim()) : undefined;
      out.push(s ? { ...t, scheduleId: s.id, name: s.name ?? t.name } : t);
      continue;
    }
    if (t.type === 'simple') {
      const hasMonthly = t.monthly != null && t.monthly !== 0;
      if (t.limit) {
        out.push(limitEntry(t.limit, t.description && !hasMonthly ? { description: t.description } : {}));
        if (t.monthly == null) out.push({ type: 'refill', directive: 'template', priority: t.priority });
      }
      const contribution = hasMonthly || (t.monthly === 0 && t.limit == null) ? t.monthly : null;
      if (contribution != null) {
        out.push({ type: 'periodic', amount: contribution, period: { period: 'month', amount: 1 }, starting: `${ym(now)}-01`, directive: 'template', priority: t.priority, ...(t.description ? { description: t.description } : {}) });
      }
      continue;
    }
    if ((t.type === 'periodic' || t.type === 'remainder') && t.limit) {
      const { limit, ...base } = t;
      out.push(base, limitEntry(limit));
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * A category's end of month cleanup, written as Actual's `#cleanup` note lines without the prefix
 * (cleanup-template.pegjs at v26.11.0): "source" and "sink [weight]" use To Budget, "<pool> source"
 * and "<pool> sink [weight]" a named pool, and a bare "<pool>" receives from it only enough to cover
 * overspending. The editor's send / receive / "only enough to cover any overspending" map to
 * source / sink / bare pool. A missing or 0 weight is 1, as upstream parses it.
 */
export type CleanupRow = { role: 'source' | 'sink' | 'overspend'; pool: string | null; weight?: number };

/**
 * Parse one line the way cleanup-template.pegjs does: its choices are tried in order and the first
 * that starts to match must consume the whole line, so "Fun sink 1.5" or "Fun sources" is an error,
 * not a pool name. Returns the row, or why the line is not valid.
 */
function parseCleanupLine(line: string): CleanupRow | string {
  const bad = `cleanup line "${line}" is not valid`;
  if (/[\r\n]/.test(line)) return bad;
  if (line.startsWith('source')) return line === 'source' ? { role: 'source', pool: null } : bad;
  if (line.startsWith('sink')) {
    const m = /^sink *(\d*)$/.exec(line);
    return m ? { role: 'sink', pool: null, weight: Number(m[1]) || 1 } : bad;
  }
  const src = line.indexOf(' source');
  if (src >= 0) return line.slice(src).trim() === 'source' ? { role: 'source', pool: line.slice(0, src) } : bad;
  const snk = line.indexOf(' sink');
  if (snk >= 0) {
    const m = /^ *sink *(\d*)$/.exec(line.slice(snk));
    return m ? { role: 'sink', pool: line.slice(0, snk), weight: Number(m[1]) || 1 } : bad;
  }
  return { role: 'overspend', pool: line };
}

export const CleanupSchema = z
  .array(z.string().trim().min(1).max(100).regex(/^(?!#)/, 'leave out the "#cleanup" prefix'))
  .max(20)
  .superRefine((lines, ctx) => lines.forEach((line, i) => {
    const row = parseCleanupLine(line);
    if (typeof row === 'string') ctx.addIssue({ code: 'custom', path: [i], message: row });
  }))
  .describe('"source", "sink [weight]", "<pool> source", "<pool> sink [weight]", "<pool>" (overspending only); [] clears.');

/** Rows for lines CleanupSchema accepted; pool names stay unresolved. */
export function toCleanupRows(lines: string[]): CleanupRow[] {
  return lines.map((line) => parseCleanupLine(line) as CleanupRow);
}
