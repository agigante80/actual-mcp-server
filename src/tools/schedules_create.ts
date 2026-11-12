import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { RecurConfigSchema } from '../lib/schemas/recur.js';
import { ScheduleAmountSchema, amountOpMismatch, ISBETWEEN_NEEDS_RANGE } from '../lib/schemas/schedule-amount.js';

const InputSchema = z.object({
  name: z.string().optional()
    .describe('Unique display name'),
  payee: CommonSchemas.payeeId.optional()
    .describe('Payee UUID'),
  account: CommonSchemas.accountId.optional()
    .describe('Account UUID. If omitted the schedule is not tied to an account'),
  amount: ScheduleAmountSchema.optional()
    .describe('Amount in cents, negative = expense. A number, or { num1, num2 } only with amountOp isbetween (order does not matter)'),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional().default('is')
    .describe('How to match the amount'),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('One-off schedule on this date'),
    RecurConfigSchema
      .describe('Recurring schedule'),
  ]).describe('YYYY-MM-DD for one-off, RecurConfig object for recurring. Required.'),
  posts_transaction: z.boolean().optional().default(false)
    .describe('Auto-post a transaction on each occurrence'),
}).superRefine((input, ctx) => {
  // #527: refused here, before any upstream call; see src/lib/schemas/schedule-amount.ts.
  const message = input.amount === undefined
    ? (input.amountOp === 'isbetween' ? ISBETWEEN_NEEDS_RANGE : null)
    : amountOpMismatch(input.amountOp, input.amount);
  if (message) ctx.addIssue({ code: 'custom', path: ['amount'], message });
});

const tool: ToolDefinition = {
  name: 'actual_schedules_create',
  description:
    "Create a schedule: one-off (date YYYY-MM-DD) or recurring (date as a RecurConfig: frequency and start, optional endMode, monthly patterns). Amounts in cents, negative for expenses. Preview its dates with actual_schedules_dates; change it with actual_schedules_update. Returns { id }.",
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
