import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { RecurConfigSchema } from '../lib/schemas/recur.js';
import { ScheduleAmountSchema, amountOpMismatch } from '../lib/schemas/schedule-amount.js';

const InputSchema = z.strictObject({
  id: CommonSchemas.scheduleId.describe('Schedule UUID'),
  name: z.string().optional()
    .describe('New display name'),
  payee: CommonSchemas.payeeId.nullable().optional()
    .describe('New payee UUID, null to clear'),
  account: CommonSchemas.accountId.nullable().optional()
    .describe('New account UUID, null to clear'),
  amount: ScheduleAmountSchema.optional()
    .describe('New amount in cents, negative = expense. A number, or { num1, num2 } only with amountOp isbetween'),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional()
    .describe('How to match the amount'),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe('One-off schedule on this date'),
    RecurConfigSchema
      .describe('Recurring schedule'),
  ]).optional()
    .describe('New YYYY-MM-DD date or RecurConfig object'),
  posts_transaction: z.boolean().optional()
    .describe('Auto-post a transaction on each occurrence'),
  resetNextDate: z.boolean().optional().default(false)
    .describe('Recalculate next_date'),
  // #627: strict, because upstream updateSchedule refuses `completed` and `next_date` as
  // system-managed. A stripped key would return success while changing nothing; an advertised
  // one failed upstream after the write queue. Either is refused here, before any write, as
  // "unexpected field(s): completed" (formatZodError sanitises the key); the description says why.
}).superRefine((input, ctx) => {
  // #527: with both fields supplied the input alone decides. With only one, the answer
  // depends on the stored schedule, so adapter.updateSchedule checks it inside the write queue.
  if (input.amount === undefined || input.amountOp === undefined) return;
  const message = amountOpMismatch(input.amountOp, input.amount);
  if (message) ctx.addIssue({ code: 'custom', path: ['amount'], message });
});

const tool: ToolDefinition = {
  name: 'actual_schedules_update',
  description: `Update a schedule; supply only the fields to change. A new date replaces the stored recurrence, patterns included. Set resetNextDate: true when changing the date or recurrence. Completion and next_date are managed by Actual and cannot be set.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const { id, resetNextDate, ...fields } = input;
    await adapter.updateSchedule(id, fields, resetNextDate ?? false);
    return { success: true };
  },
};

export default tool;
