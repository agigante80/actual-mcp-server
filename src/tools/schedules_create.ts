import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { RecurConfigSchema } from '../lib/schemas/recur.js';

const InputSchema = z.object({
  name: z.string().optional()
    .describe('Unique display name'),
  payee: CommonSchemas.payeeId.optional()
    .describe('Payee UUID'),
  account: CommonSchemas.accountId.optional()
    .describe('Account UUID. If omitted the schedule is not tied to an account'),
  amount: z.number().int().optional()
    .describe('Amount in cents, negative = expense'),
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
});

const tool: ToolDefinition = {
  name: 'actual_schedules_create',
  description: `Create a schedule, one-off (YYYY-MM-DD date) or recurring (RecurConfig object with frequency, start, endMode). Amounts are in cents, negative for expenses.`,
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
