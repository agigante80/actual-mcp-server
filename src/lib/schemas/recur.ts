import { z } from 'zod';

// Shared recurrence-config schema for Actual schedules. Used by both actual_schedules_create
// and actual_schedules_update so the two tools agree on the same shape and publish a typed
// `date` branch in tools/list (#225). This mirrors the config Actual's `@actual-app/api`
// accepts for a recurring schedule; it is a closed object so a malformed config gets an
// actionable validation error rather than being forwarded unshaped.
export const RecurConfigSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly'])
    .describe('How often the schedule repeats'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Start date in YYYY-MM-DD format'),
  endMode: z.enum(['never', 'after_n_occurrences', 'on_date'])
    .describe('When the schedule stops: never, after N occurrences, or on a specific date'),
  interval: z.number().int().positive().optional()
    .describe('Every N periods. Default: 1 (every period)'),
  skipWeekend: z.boolean().optional()
    .describe('If true, occurrence is moved when it falls on a weekend'),
  weekendSolveMode: z.enum(['before', 'after']).optional()
    .describe('Move to Friday before or Monday after the weekend. Requires skipWeekend: true'),
  endOccurrences: z.number().int().positive().optional()
    .describe('Number of occurrences before stopping. Required when endMode is after_n_occurrences'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Date (YYYY-MM-DD) after which the schedule stops. Required when endMode is on_date'),
});
