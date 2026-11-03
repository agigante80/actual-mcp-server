import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';
import { SCHEDULE_DATES_CAP } from '../lib/constants.js';

export default createTool({
  name: 'actual_schedules_dates',
  description:
    'List the dates one schedule falls on, computed by Actual itself, so month ends, patterns ' +
    '("last Friday"), intervals and the weekend move match the Actual UI. Use this instead of ' +
    'expanding a schedule\'s recurrence yourself. Get schedule ids from actual_schedules_get. ' +
    '`start` defaults to today; pass it whenever you pass `end`. With `end` and `count` both set, the list stops at whichever ' +
    `comes first. At most ${SCHEDULE_DATES_CAP} dates are returned. \`truncated\` is true when more dates exist ` +
    'after the last one returned (within `end`, if given): ask again with a later `start` to continue. ' +
    'Returns { schedule_id, name, dates (ascending YYYY-MM-DD), count, truncated }.',
  schema: z.object({
    schedule_id: CommonSchemas.scheduleId,
    start: CommonSchemas.date.optional().describe('First date to consider (YYYY-MM-DD); defaults to today'),
    end: CommonSchemas.date.optional().describe('Last date to consider (YYYY-MM-DD), inclusive'),
    count: z.number().int().min(1).max(SCHEDULE_DATES_CAP).optional()
      .describe(`How many dates to return, 1 to ${SCHEDULE_DATES_CAP}`),
  }),
  handler: async ({ schedule_id, start, end, count }) => {
    return await adapter.getScheduleDates(schedule_id, { start, end, count });
  },
  examples: [
    {
      description: 'Next three dates of a schedule',
      input: { schedule_id: '00000000-0000-0000-0000-000000000001', count: 3 },
    },
    {
      description: 'Every date of a schedule in Q4 2026',
      input: { schedule_id: '00000000-0000-0000-0000-000000000001', start: '2026-10-01', end: '2026-12-31' },
    },
  ],
});
