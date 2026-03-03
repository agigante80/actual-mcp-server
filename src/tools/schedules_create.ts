import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { UUID_PATTERN } from '../lib/constants.js';

const RecurConfigSchema = z.object({
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

const InputSchema = z.object({
  name: z.string().optional()
    .describe('Unique display name for the schedule'),
  payee: z.string().regex(UUID_PATTERN, 'Invalid UUID format').optional()
    .describe('Payee UUID (from actual_payees_get)'),
  account: z.string().regex(UUID_PATTERN, 'Invalid UUID format').optional()
    .describe('Account UUID (from actual_accounts_list). If omitted the schedule is not tied to an account'),
  amount: z.number().int().optional()
    .describe('Amount in cents. Negative = expense (e.g. -5000 = -$50.00), positive = income'),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional().default('is')
    .describe('How to match the amount. "isbetween" requires amount to be an object { num1, num2 }'),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('YYYY-MM-DD — one-off schedule on this specific date'),
    RecurConfigSchema
      .describe('RecurConfig object — recurring schedule'),
  ]).describe('Date string for one-off or RecurConfig object for recurring. Required.'),
  posts_transaction: z.boolean().optional().default(false)
    .describe('When true, Actual automatically posts a transaction on each occurrence'),
});

const tool: ToolDefinition = {
  name: 'actual_schedules_create',
  description: `Create a new schedule in Actual Budget. Schedules can be one-off (supply a YYYY-MM-DD date string) or recurring (supply a RecurConfig object with frequency, start, and endMode). Amounts are in cents — negative for expenses, positive for income.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const { date, ...rest } = input;
    const schedule = { ...rest, date };
    const id = await adapter.createSchedule(schedule);
    return { id };
  },
};

export default tool;
