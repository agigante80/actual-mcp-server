import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { UUID_PATTERN } from '../lib/constants.js';

const InputSchema = z.object({
  id: z.string().regex(UUID_PATTERN, 'Invalid UUID format')
    .describe('UUID of the schedule to update (from actual_schedules_get)'),
  name: z.string().optional()
    .describe('New display name for the schedule'),
  payee: z.string().regex(UUID_PATTERN, 'Invalid UUID format').nullable().optional()
    .describe('New payee UUID, or null to clear'),
  account: z.string().regex(UUID_PATTERN, 'Invalid UUID format').nullable().optional()
    .describe('New account UUID, or null to clear'),
  amount: z.number().int().optional()
    .describe('New amount in cents. Negative = expense, positive = income'),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional()
    .describe('How to match the amount'),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.object({}).passthrough(),
  ]).optional()
    .describe('New date string (YYYY-MM-DD) or RecurConfig object'),
  posts_transaction: z.boolean().optional()
    .describe('Whether Actual auto-posts a transaction on each occurrence'),
  completed: z.boolean().optional()
    .describe('Mark the schedule as completed (true) or reactivate it (false)'),
  resetNextDate: z.boolean().optional().default(false)
    .describe('When true, recalculates next_date based on the updated date/recurrence config. Set to true whenever you change the date field.'),
});

const tool: ToolDefinition = {
  name: 'actual_schedules_update',
  description: `Update an existing schedule in Actual Budget. Supply the schedule's UUID and only the fields you want to change. Set resetNextDate: true when changing the date or recurrence config to force recalculation of next_date.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const { id, resetNextDate, ...fields } = input;
    await adapter.updateSchedule(id, fields, resetNextDate ?? false);
    return { success: true };
  },
};

export default tool;
