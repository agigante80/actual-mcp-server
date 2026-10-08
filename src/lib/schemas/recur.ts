import { z } from 'zod';

// Shared recurrence-config schema for Actual schedules. Used by both actual_schedules_create
// and actual_schedules_update so the two tools agree on the same shape and publish a typed
// `date` branch in tools/list (#225). This mirrors the config Actual's `@actual-app/api`
// accepts for a recurring schedule; it is a closed object so a malformed config gets an
// actionable validation error rather than being forwarded unshaped.
export const RecurConfigSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly'])
    .describe('How often it repeats'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Start date, YYYY-MM-DD'),
  endMode: z.enum(['never', 'after_n_occurrences', 'on_date'])
    .describe('When it stops'),
  interval: z.number().int().positive().optional()
    .describe('Every N periods. Default 1'),
  skipWeekend: z.boolean().optional()
    .describe('Move an occurrence that falls on a weekend'),
  weekendSolveMode: z.enum(['before', 'after']).optional()
    .describe('Friday before or Monday after. Requires skipWeekend'),
  endOccurrences: z.number().int().positive().optional()
    .describe('Required when endMode is after_n_occurrences'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('YYYY-MM-DD. Required when endMode is on_date'),
});
