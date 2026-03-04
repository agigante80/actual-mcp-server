import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';

const InputSchema = z.object({
  payeeId: z.string().describe('ID of the payee to get rules for'),
});

const tool: ToolDefinition = {
  name: 'actual_payee_rules_get',
  description: `Get all payee rules associated with a specific payee. Returns PayeeRule objects that show how transactions with this payee are automatically processed (conditions and actions).`,
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
