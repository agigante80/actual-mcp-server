import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { deletePayee: rawDeletePayee } = api as any;

const InputSchema = z.object({
  id: z.string().describe('Payee ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_payees_delete',
  description: 'Delete a payee from Actual Budget. Transactions using this payee will have it removed. This operation cannot be undone.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Single-write tool, but uses withWriteSession for consistency with the other
    // delete tools and to share the same lock-cycle invariant (#142).
    return await adapter.withWriteSession(async () => {
      await rawDeletePayee(input.id);
      return { success: true };
    });
  },
};

export default tool;
