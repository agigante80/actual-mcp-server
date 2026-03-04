import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { UUID_PATTERN } from '../lib/constants.js';
import { notFoundMsg, constraintErrorMsg } from '../lib/errors.js';

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
    // Pre-flight: verify schedule exists (BUG-11)
    const schedules = await adapter.getSchedules();
    const scheduleExists = (schedules as any[]).some((s: any) => s.id === input.id);
    if (!scheduleExists) {
      return {
        error: notFoundMsg('Schedule', input.id, 'actual_schedules_get'),
        success: false,
      };
    }
    try {
      await adapter.deleteSchedule(input.id);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Translate raw SQLite constraint errors into user-readable messages
      if (msg.includes('NOT NULL constraint') || msg.includes('messages_crdt')) {
        return {
          error: constraintErrorMsg('Schedule', input.id, 'actual_schedules_get'),
          success: false,
        };
      }
      throw err;
    }
  },
};

export default tool;
