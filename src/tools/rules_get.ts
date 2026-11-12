import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({});

const tool: ToolDefinition = {
  name: 'actual_rules_get',
  description:
    'List every rule in the open budget (read-only). Rules automate how transactions are processed; each has id, stage (pre, null or post), conditionsOp (and or or), conditions such as payee is <payee id>, and actions such as set category to <category id>; values are ids, not names. ' +
    'Use it to find a rule id for actual_rules_update or actual_rules_delete. For the rules of one payee use actual_payee_rules_get; to add one use actual_rules_create. Returns { rules: [...] }, empty when there are none.',
  inputSchema: InputSchema,
  call: async (_args: unknown, _meta?: unknown) => {
    const rules = await adapter.getRules();
    return { rules };
  },
};

export default tool;
