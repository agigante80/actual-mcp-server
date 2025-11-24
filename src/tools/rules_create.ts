import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Define the schema for rule conditions and actions
const ConditionSchema = z.object({
  field: z.string().describe('Field to match (e.g., "payee", "notes", "amount", "category")'),
  op: z.string().describe('Operation (e.g., "is", "contains", "isapprox", "gte", "lte")'),
  value: z.union([z.string(), z.number()]).describe('Value to match against'),
  type: z.string().optional().describe('Type of condition (e.g., "string", "number", "id")'),
});

const ActionSchema = z.object({
  op: z.string()
    .default('set')
    .describe('Operation to perform. Options: "set" (default, assign value to field), "set-split-amount" (split transaction), "link-schedule" (link to scheduled transaction), "prepend-notes" (add text before notes), "append-notes" (add text after notes)'),
  field: z.string()
    .optional()
    .describe('Field to modify - required for "set" operation. Options: "category" (transaction category), "payee" (transaction payee), "notes" (transaction notes), "cleared" (cleared status), "account" (move to different account)'),
  value: z.union([z.string(), z.number(), z.boolean(), z.object({}).passthrough()])
    .describe('Value to assign. Use category/payee/account UUID for "id" types, text for "string" types, number for amounts'),
  type: z.string()
    .optional()
    .describe('Value type hint. Options: "id" (UUID for category/payee/account), "string" (text value), "number" (numeric value), "boolean" (true/false)'),
  options: z.object({}).passthrough().optional().describe('Additional options for the action'),
});

const InputSchema = z.object({
  stage: z.enum(['pre', 'default', 'post']).optional().default('pre').describe('When to apply the rule - "pre" (before), "default" (normal), or "post" (after)'),
  conditionsOp: z.enum(['and', 'or']).optional().default('and').describe('How to combine multiple conditions'),
  conditions: z.array(ConditionSchema).describe('Array of conditions that must be met for the rule to apply'),
  actions: z.array(ActionSchema).describe('Array of actions to perform when conditions are met'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_create',
  description: `Create a new budget rule in Actual Budget. Rules automate transaction management by applying actions when conditions are met.

Common use cases:
- Auto-categorize: Match payee/notes, set category (most common - "op": "set" is default and optional)
- Auto-clear: Mark transactions as cleared
- Auto-tag: Add notes to transactions
- Split transactions: Distribute amounts across categories

Example (auto-categorize):
{
  "conditions": [{"field": "payee", "op": "contains", "value": "Amazon", "type": "string"}],
  "actions": [{"field": "category", "value": "<category-uuid>", "type": "id"}],
  "stage": "post"
}

Note: "op" defaults to "set" if omitted. Use "type": "id" for category/payee/account UUIDs.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      // Validate that actions with op="set" have a field
      for (const action of input.actions) {
        if (action.op === 'set' && !action.field) {
          throw new Error('Action with op="set" requires a "field" property (e.g., "category", "payee", "notes", "cleared")');
        }
      }
      
      const ruleId = await adapter.createRule(input);
      return { id: ruleId, success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Invalid rule data: ${fieldErrors}`);
      }
      throw error;
    }
  },
};

export default tool;
