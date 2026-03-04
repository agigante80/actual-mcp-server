import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';

const InputSchema = z.object({
  id: z.string().describe('Rule ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_delete',
  description: `Delete a budget rule from Actual Budget. The rule will no longer be applied to new or existing transactions. This operation cannot be undone.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Pre-flight: verify rule exists (BUG-9)
    const allRules = await adapter.getRules();
    const ruleExists = (allRules as any[]).some((r: any) => r.id === input.id);
    if (!ruleExists) {
      return {
        error: notFoundMsg('Rule', input.id, 'actual_rules_get'),
        success: false,
      };
    }
    await adapter.deleteRule(input.id);
    return { success: true };
  },
};

export default tool;
