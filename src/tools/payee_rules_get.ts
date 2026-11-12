import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { notFoundMsg } from '../lib/errors.js';

const InputSchema = z.object({
  payeeId: CommonSchemas.payeeId.describe('ID of the payee to get rules for'),
});

const tool: ToolDefinition = {
  name: 'actual_payee_rules_get',
  description:
    "List the rules that reference one payee (payeeId; find it with actual_payees_get): the conditions that match its transactions and the actions they apply. Read-only. For every rule use actual_rules_get. Returns { rules, count, payeeName }; an unknown payee returns { error, rules: [], count: 0 } instead of failing.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Pre-flight: verify payee exists and get its name (BUG-3)
    const payees = await adapter.getPayees();
    const payee = (payees as any[]).find((p: any) => p.id === input.payeeId);
    if (!payee) {
      return {
        error: notFoundMsg('Payee', input.payeeId, 'actual_payees_get'),
        rules: [],
        count: 0,
      };
    }
    const rules = await adapter.getPayeeRules(input.payeeId);
    return { rules, count: rules.length, payeeName: payee.name };
  },
};

export default tool;
