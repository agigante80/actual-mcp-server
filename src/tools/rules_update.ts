import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Define the schema for rule conditions and actions (same as create)
const ConditionSchema = z.object({
  field: z.string().describe('Field to match (e.g., "payee", "notes", "amount", "category")'),
  op: z.string().describe('Operation (e.g., "is", "contains", "isapprox", "gte", "lte")'),
  value: z.union([z.string(), z.number()]).describe('Value to match against'),
  type: z.string().optional().describe('Type of condition (e.g., "string", "number", "id")'),
});

const ActionSchema = z.object({
  op: z.string().describe('Operation to perform (e.g., "set", "set-split-amount", "link-schedule", "prepend-notes", "append-notes")'),
  field: z.string().optional().describe('Field to set (e.g., "category", "payee", "notes", "cleared") - required for "set" operation'),
  value: z.union([z.string(), z.number(), z.boolean(), z.object({}).passthrough()]).describe('Value to set or use in operation'),
  type: z.string().optional().describe('Type of action (e.g., "id", "string", "number", "boolean")'),
  options: z.object({}).passthrough().optional().describe('Additional options for the action'),
});

const InputSchema = z.object({
  id: z.string().describe('Rule ID to update'),
  fields: z.object({
    stage: z.enum(['pre', 'post']).optional().describe('When to apply the rule - "pre" (before transactions sync) or "post" (after transactions sync)'),
    conditionsOp: z.enum(['and', 'or']).optional().describe('How to combine multiple conditions'),
    conditions: z.array(ConditionSchema).optional().describe('New array of conditions'),
    actions: z.array(ActionSchema).optional().describe('New array of actions'),
  }).describe('Fields to update'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_update',
  description: `Update an existing budget rule by ID. Only provide the fields you want to change.

IMPORTANT Field Types:
- "imported_payee" (string) - for text matching payee names. Supports: contains, matches, doesNotContain, is, isNot
- "payee" (ID) - for exact payee ID matching. Supports: is, isNot, oneOf, notOneOf
- "account", "category" (ID) - for account/category IDs. Supports: is, isNot, oneOf, notOneOf
- "notes", "description" (string) - for text matching. Supports: contains, matches, doesNotContain, is, isNot
- "amount", "date" (number/date) - supports: is, gte, lte, gt, lt

Stage options: 'pre' or 'post'.
Action operators: 'set', 'set-split-amount', 'link-schedule', 'append-notes'.

Do not include the rule ID in the fields object - it is provided separately.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Validate action field values
    if (input.fields.actions) {
      for (const action of input.fields.actions) {
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
    }
    
    // Validate field usage to guide users toward correct field selection
    if (input.fields.conditions) {
      for (const condition of input.fields.conditions) {
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
    }
    
    // No automatic translation - require explicit field names
    const fields = JSON.parse(JSON.stringify(input.fields)); // deep clone
    
    await adapter.updateRule(input.id, fields);
    return { success: true };
  },
};

export default tool;
