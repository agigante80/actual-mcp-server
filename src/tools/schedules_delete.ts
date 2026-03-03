import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { UUID_PATTERN } from '../lib/constants.js';

const InputSchema = z.object({
  id: z.string().regex(UUID_PATTERN, 'Invalid UUID format')
    .describe('UUID of the schedule to delete (from actual_schedules_get)'),
});

const tool: ToolDefinition = {
  name: 'actual_schedules_delete',
  description: `Permanently delete a schedule from Actual Budget. The schedule's underlying rule is also removed. This operation cannot be undone.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteSchedule(input.id);
    return { success: true };
  },
};

export default tool;
