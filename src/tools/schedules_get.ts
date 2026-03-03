import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_schedules_get',
  description: `List all schedules in Actual Budget. Schedules automate recurring transactions (e.g. monthly rent, weekly grocery runs). Each schedule has a date rule (one-off or RecurConfig), optional payee/account/amount, and a next_date field showing when it fires next.`,
  inputSchema: InputSchema,
  call: async (_args: unknown, _meta?: unknown) => {
    const schedules = await adapter.getSchedules();
    return { schedules, count: Array.isArray(schedules) ? schedules.length : 0 };
  },
};

export default tool;
