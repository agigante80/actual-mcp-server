import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  id: CommonSchemas.scheduleId.describe('UUID of the schedule to delete (from actual_schedules_get)'),
});

/**
 * #376: the existence guard and the SQLite constraint-error translation live in
 * `adapter.deleteSchedule`, which reads and writes in one write-queue cycle. They used to
 * sit here inside the tool's own `withWriteSession`.
 */
const tool: ToolDefinition = {
  name: 'actual_schedules_delete',
  description:
    "Permanently delete one schedule by id, together with the rule that drives it. Transactions it already created stay. An unknown id is refused, pointing at actual_schedules_get. To change a schedule instead use actual_schedules_update. Cannot be undone. Returns { success: true }.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    await adapter.deleteSchedule(input.id);
    return { success: true };
  },
};

export default tool;
