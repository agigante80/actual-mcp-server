import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { ACTION_DESCRIBE, CONDITION_OPERATORS_HELP, ConditionSchema, STAGE_DESCRIBE } from '../lib/schemas/rules.js';

// #486: the condition schema is the shared one. The action schema stays private because `op`
// is REQUIRED here (the shared one defaults it to "set"); only the describe text is shared.
const ActionSchema = z.object({
  op: z.string().describe(ACTION_DESCRIBE.op),
  field: z.string().optional().describe(ACTION_DESCRIBE.field),
  value: z.union([z.string(), z.number(), z.boolean(), z.object({}).passthrough()]).describe(ACTION_DESCRIBE.value),
  type: z.string().optional().describe(ACTION_DESCRIBE.type),
  options: z.object({}).passthrough().optional().describe(ACTION_DESCRIBE.options),
});

// Operator validation map
const FIELD_OPERATORS: Record<string, { type: string; operators: string[] }> = {
  'imported_payee': { type: 'string', operators: ['contains', 'matches', 'doesNotContain', 'is', 'isNot'] },
  'payee': { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf'] },
  'account': { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf'] },
  'category': { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf'] },
  'notes': { type: 'string', operators: ['contains', 'matches', 'doesNotContain', 'is', 'isNot'] },
  'description': { type: 'string', operators: ['contains', 'matches', 'doesNotContain', 'is', 'isNot'] },
  'amount': { type: 'number', operators: ['is', 'gte', 'lte', 'gt', 'lt', 'isapprox'] },
  'date': { type: 'date', operators: ['is', 'gte', 'lte', 'gt', 'lt'] },
};

const InputSchema = z.object({
  id: CommonSchemas.ruleId.describe('Rule ID to update'),
  fields: z.object({
    // #342: null is Actual's DEFAULT stage; the literal "default" is rejected by
    // its validator. Deliberately NO .default() here: this is a partial update, so
    // omitting stage must leave the existing one alone. Actual only validates
    // stage on an update when the key is present, so omitting it is safe (unlike
    // on a create, where undefined is rejected).
    stage: z
      .enum(['pre', 'post'])
      .nullable()
      .optional()
      .describe(`${STAGE_DESCRIBE}. Omit to leave the rule's current stage unchanged`),
    conditionsOp: z.enum(['and', 'or']).optional().describe('How to combine conditions'),
    conditions: z.array(ConditionSchema).optional().describe('New conditions'),
    actions: z.array(ActionSchema).optional().describe('New actions'),
  }).describe('Fields to update'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_update',
  description: `Update an existing budget rule by ID. Only provide the fields you want to change; do not repeat the rule ID inside fields.

${CONDITION_OPERATORS_HELP}
Stage: omit it to leave the rule where it is, pass null for the normal stage, or 'pre' / 'post'. Do NOT pass "default"; Actual rejects it.`,
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
        const fieldInfo = FIELD_OPERATORS[condition.field];
        
        // Validate operator is compatible with field type
        if (fieldInfo && !fieldInfo.operators.includes(condition.op)) {
          throw new Error(
            `Invalid operator "${condition.op}" for field "${condition.field}". ` +
            `Field "${condition.field}" is a ${fieldInfo.type} field and only supports: ${fieldInfo.operators.join(', ')}. ` +
            `Please use one of these operators instead.`
          );
        }
        
        // Check if using payee field with text value instead of ID
        if (condition.field === 'payee' && typeof condition.value === 'string' && !condition.value.match(/^[0-9a-f-]{36}$/i)) {
          throw new Error(
            `Field "payee" expects a payee ID (UUID), but got text value "${condition.value}". ` +
            `To match payee names with text, use "imported_payee" field instead. ` +
            `Example: {field: "imported_payee", op: "contains", value: "${condition.value}"}`
          );
        }
        
        // Similar validation for account and category
        if (['account', 'category'].includes(condition.field) && typeof condition.value === 'string' && !condition.value.match(/^[0-9a-f-]{36}$/i)) {
          throw new Error(
            `Field "${condition.field}" expects an ID (UUID), but got text value "${condition.value}". ` +
            `Use the ${condition.field} UUID from your budget data. List ${condition.field === 'account' ? 'accounts' : 'categories'} to find the correct UUID.`
          );
        }
        
        // Validate oneOf/notOneOf operators expect array values
        if (['oneOf', 'notOneOf'].includes(condition.op) && !Array.isArray(condition.value)) {
          throw new Error(
            `Operator "${condition.op}" expects an array of values, but got ${typeof condition.value}. ` +
            `Example: {field: "${condition.field}", op: "${condition.op}", value: ["uuid-1", "uuid-2"]}`
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
