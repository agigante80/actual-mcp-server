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
  field: z.string().describe('Field to set (e.g., "category", "payee", "notes", "cleared")'),
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Value to set'),
  type: z.string().optional().describe('Type of action'),
});

const InputSchema = z.object({
  conditions: z.array(ConditionSchema).describe('Array of conditions that must be met for the rule to apply'),
  actions: z.array(ActionSchema).describe('Array of actions to perform when conditions are met'),
  stage: z.string().optional().describe('When to apply the rule (e.g., "pre", "post")'),
  conditionsOp: z.enum(['and', 'or']).optional().default('and').describe('How to combine multiple conditions'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_create',
  description: `Create a new budget rule in Actual Budget. Rules automate transaction management by applying actions when conditions are met. Example: automatically categorize Amazon transactions as "Shopping".`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    const ruleId = await adapter.createRule(input);
    return { id: ruleId, success: true };
  },
};

export default tool;
