import { z } from 'zod';
import { oneOffDateSchema } from './common.js';
import { isCalendarDay } from '../dates.js';

// Shared recurrence-config schema for Actual schedules. Used by both actual_schedules_create
// and actual_schedules_update so the two tools agree on the same shape and publish a typed
// `date` branch in tools/list (#225). This mirrors the config Actual's `@actual-app/api`
// accepts for a recurring schedule; it is a closed object so a malformed config gets an
// actionable validation error rather than being forwarded unshaped.
// #478: Actual's monthly patterns (the UI's "the 1st and 15th", "last day", "second Monday").
// `day` maps to a day of the month, a weekday to the nth weekday; upstream honours them only
// for frequency 'monthly'.
const RecurPatternSchema = z.object({
  type: z.enum(['day', 'SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])
    .describe("'day' for a day of the month, or a weekday code"),
  value: z.number().int().describe('Day 1 to 31, or week 1 to 5 of the month; -1 is the last'),
}).strict();

export const PATTERNS_NEED_MONTHLY =
  "patterns apply only to frequency 'monthly'; omit patterns or send patterns: []";
export const DAY_PATTERN_RANGE = "a 'day' pattern value must be 1 to 31, or -1 for the last day";
export const WEEKDAY_PATTERN_RANGE = 'a weekday pattern value must be 1 to 5 (nth), or -1 (last)';
// #786: upstream validates a recurrence only when it previews dates, never on create or update, so
// these are refused here, before any write.
export const END_OCCURRENCES_REQUIRED = 'endOccurrences is required when endMode is after_n_occurrences';
export const END_DATE_REQUIRED = 'endDate is required when endMode is on_date';
export const END_BEFORE_START = 'endDate must not be before start';

// The object is strict: a plain z.object STRIPS unknown keys, which is how a `patterns` field
// used to vanish while the create reported success (#478). Every key upstream's RecurConfig
// defines is listed, so strictness refuses only keys Actual would ignore anyway.
export const RecurConfigSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly'])
    .describe('How often it repeats'),
  start: oneOffDateSchema
    .describe('Start date, YYYY-MM-DD'),
  // Optional because upstream reads a schedule back without endMode when none was set and
  // treats a missing one as never; passed through as given, no default injected.
  endMode: z.enum(['never', 'after_n_occurrences', 'on_date']).optional()
    .describe('When it stops. Omitted means never'),
  interval: z.number().int().positive().optional()
    .describe('Every N periods. Default 1'),
  patterns: z.array(RecurPatternSchema).optional()
    .describe('Monthly only. day: 1 to 31, -1 last day. SU to SA: 1 to 5 nth, -1 last'),
  skipWeekend: z.boolean().optional()
    .describe('Move weekend occurrences'),
  weekendSolveMode: z.enum(['before', 'after']).optional()
    .describe('Friday before or Monday after. Requires skipWeekend'),
  endOccurrences: z.number().int().positive().optional()
    .describe('Required when endMode is after_n_occurrences'),
  endDate: oneOffDateSchema.optional()
    .describe('YYYY-MM-DD. Required when endMode is on_date'),
}).strict().superRefine((cfg, ctx) => {
  const patterns = cfg.patterns ?? [];
  // An empty list is accepted on any frequency: upstream reads every schedule back with
  // patterns: [], and a client echoing it must not be refused.
  if (patterns.length > 0 && cfg.frequency !== 'monthly') {
    ctx.addIssue({ code: 'custom', path: ['patterns'], message: PATTERNS_NEED_MONTHLY });
  }
  // #786: read-back echoes stay accepted (endDate or endOccurrences with another endMode, and
  // weekendSolveMode without skipWeekend); only a mode missing the field it needs is refused.
  if (cfg.endMode === 'after_n_occurrences' && cfg.endOccurrences === undefined) {
    ctx.addIssue({ code: 'custom', path: [], message: END_OCCURRENCES_REQUIRED });
  }
  if (cfg.endMode === 'on_date' && cfg.endDate === undefined) {
    ctx.addIssue({ code: 'custom', path: [], message: END_DATE_REQUIRED });
  }
  // Both must be real days (a bad one already has its own issue); YYYY-MM-DD compares as a
  // string, and an equal pair is allowed.
  // Only under on_date: upstream reads endDate in no other mode, and the Actual UI stores a
  // leftover endDate next to endMode never. Refusing that echo broke an update that sends a
  // stored recurrence back (review of #786), so do not widen this to every mode again.
  if (cfg.endMode === 'on_date' && cfg.endDate !== undefined && isCalendarDay(cfg.start) && isCalendarDay(cfg.endDate) && cfg.endDate < cfg.start) {
    ctx.addIssue({ code: 'custom', path: [], message: END_BEFORE_START });
  }
  // The index in the path and the pattern in the message tell a caller which entry to fix
  // when several are sent.
  patterns.forEach((p, i) => {
    const ok = p.value === -1 || (p.type === 'day' ? p.value >= 1 && p.value <= 31 : p.value >= 1 && p.value <= 5);
    if (!ok) {
      const range = p.type === 'day' ? DAY_PATTERN_RANGE : WEEKDAY_PATTERN_RANGE;
      ctx.addIssue({ code: 'custom', path: ['patterns', i], message: `${p.type} ${p.value}: ${range}` });
    }
  });
});
