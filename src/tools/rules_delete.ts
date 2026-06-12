// #232: load the navigator polyfill before @actual-app/api so the Node 20 global is defined first.
import '../lib/node-polyfills.js';
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getRules: rawGetRules, deleteRule: rawDeleteRule } = api as any;

const InputSchema = z.object({
  id: z.string().describe('Rule ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_delete',
  description: `Delete a budget rule from Actual Budget. The rule will no longer be applied to new or existing transactions. This operation cannot be undone.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Read+write inside one withWriteSession cycle (#142).
    return await adapter.withWriteSession(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allRules: any[] = await rawGetRules();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ruleExists = allRules.some((r: any) => r.id === input.id);
      if (!ruleExists) {
        // Throw (not return {success:false}) so a non-existent id surfaces as an MCP
        // error, consistent with every other delete tool's not-found behavior.
        throw new Error(notFoundMsg('Rule', input.id, 'actual_rules_get'));
      }
      await rawDeleteRule(input.id);
      return { success: true };
    });
  },
};

export default tool;
