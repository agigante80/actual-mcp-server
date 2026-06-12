import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { UUID_PATTERN } from '../lib/constants.js';
import { notFoundMsg, constraintErrorMsg } from '../lib/errors.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getSchedules: rawGetSchedules, deleteSchedule: rawDeleteSchedule } = api as any;

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
    // Read+write inside one withWriteSession cycle (#142). The constraint-error
    // translation stays right around the delete call so error messages do not regress.
    return await adapter.withWriteSession(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schedules: any[] = await rawGetSchedules();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scheduleExists = schedules.some((s: any) => s.id === input.id);
      if (!scheduleExists) {
        // Throw (not return {success:false}) so a non-existent id surfaces as an MCP
        // error, consistent with every other delete tool's not-found behavior.
        throw new Error(notFoundMsg('Schedule', input.id, 'actual_schedules_get'));
      }
      try {
        await rawDeleteSchedule(input.id);
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('NOT NULL constraint') || msg.includes('messages_crdt')) {
          // Translate the raw SQLite constraint error into an actionable message, thrown
          // for the same consistency reason as the not-found case above.
          throw new Error(constraintErrorMsg('Schedule', input.id, 'actual_schedules_get'));
        }
        throw err;
      }
    });
  },
};

export default tool;
