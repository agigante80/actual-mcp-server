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
  stage: z.enum(['pre', 'post']).optional().default('pre').describe('When to apply the rule - "pre" (before transactions sync) or "post" (after transactions sync)'),
  conditionsOp: z.enum(['and', 'or']).optional().default('and').describe('How to combine multiple conditions'),
  conditions: z.array(ConditionSchema).describe('Array of conditions that must be met for the rule to apply'),
  actions: z.array(ActionSchema).describe('Array of actions to perform when conditions are met'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_create',
  description: `Create a new budget rule with conditions and actions.

IMPORTANT Field Types:
- "imported_payee" (string) - for text matching payee names. Supports: contains, matches, doesNotContain, is, isNot
- "payee" (ID) - for exact payee ID matching. Supports: is, isNot, oneOf, notOneOf
- "account", "category" (ID) - for account/category IDs. Supports: is, isNot, oneOf, notOneOf
- "notes", "description" (string) - for text matching. Supports: contains, matches, doesNotContain, is, isNot
- "amount", "date" (number/date) - supports: is, gte, lte, gt, lt

Stage options: 'pre' or 'post'.
Action operators: 'set', 'set-split-amount', 'link-schedule', 'append-notes'.

Example: {stage: "post", conditionsOp: "and", conditions: [{field: "imported_payee", op: "contains", value: "Amazon"}], actions: [{op: "set", field: "category", value: "category-uuid"}]}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      // Validate that actions with op="set" have a field
      for (const action of input.actions) {
        if (action.op === 'set' && !action.field) {
          throw new Error('Action with op="set" requires a "field" property (e.g., "category", "payee", "notes", "cleared")');
        }
        
        // Validate action field values for ID-type fields
        if (action.op === 'set' && action.field) {
          // Check if using category field with text value instead of ID
          if (action.field === 'category' && typeof action.value === 'string' && !action.value.match(/^[0-9a-f-]{36}$/i)) {
            throw new Error(
              `Action field "category" expects a category ID (UUID), but got text value "${action.value}". ` +
              `Use the category UUID from your budget data. You can list categories to find the correct UUID.`
            );
          }
          
          // Check if using payee field with text value instead of ID
          if (action.field === 'payee' && typeof action.value === 'string' && !action.value.match(/^[0-9a-f-]{36}$/i)) {
            throw new Error(
              `Action field "payee" expects a payee ID (UUID), but got text value "${action.value}". ` +
              `Use the payee UUID from your budget data. You can list payees to find the correct UUID.`
            );
          }
          
          // Check if using account field with text value instead of ID
          if (action.field === 'account' && typeof action.value === 'string' && !action.value.match(/^[0-9a-f-]{36}$/i)) {
            throw new Error(
              `Action field "account" expects an account ID (UUID), but got text value "${action.value}". ` +
              `Use the account UUID from your budget data. You can list accounts to find the correct UUID.`
            );
          }
        }
        
        // Validate append-notes and prepend-notes have string values
        if ((action.op === 'append-notes' || action.op === 'prepend-notes') && typeof action.value !== 'string') {
          throw new Error(
            `Action "${action.op}" requires a string value, but got ${typeof action.value}. ` +
            `Example: {op: "${action.op}", value: "text to ${action.op === 'append-notes' ? 'append' : 'prepend'}"}`
          );
        }
      }
      
      // Validate field usage to guide users toward correct field selection
      for (const condition of input.conditions) {
        // Check if using payee field with text value instead of ID
        if (condition.field === 'payee' && typeof condition.value === 'string' && !condition.value.match(/^[0-9a-f-]{36}$/i)) {
          throw new Error(
            `Field "payee" expects a payee ID (UUID), but got text value "${condition.value}". ` +
            `To match payee names with text, use "imported_payee" field instead. ` +
            `Example: {field: "imported_payee", op: "${condition.op}", value: "${condition.value}"}`
          );
        }
        
        // Similar validation for account and category
        if (['account', 'category'].includes(condition.field) && typeof condition.value === 'string' && !condition.value.match(/^[0-9a-f-]{36}$/i)) {
          throw new Error(
            `Field "${condition.field}" expects an ID (UUID), but got text value "${condition.value}". ` +
            `Use the ${condition.field} UUID from your budget data.`
          );
        }
      }
      
      // No automatic translation - require explicit field names
      const ruleData = JSON.parse(JSON.stringify(input)); // deep clone
      
      const ruleId = await adapter.createRule(ruleData);
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
