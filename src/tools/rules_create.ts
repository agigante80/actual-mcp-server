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
  // #342: three stages, and the default one is `null`, not a string.
  //
  // Verified against Actual's validator (transaction-rules.ts) and a live server:
  // it accepts exactly 'pre', 'post' and null, and REJECTS the literal "default"
  // with `Invalid rule stage: default`. The published API reference says
  // pre/default/post, which is wrong in both directions (reported upstream as
  // actualbudget/actual#8682).
  //
  // The default here MUST be null and must be SENT. Two traps:
  //   - Defaulting to 'pre' (what this did until #342) silently puts every
  //     MCP-created rule ahead of every rule the user made in the UI, because
  //     Actual runs stages in the order pre, default, post. No error, no warning.
  //   - Simply making it .optional() and omitting the key does NOT work: on a
  //     create the validator always runs and rejects `undefined` with
  //     `Invalid rule stage: undefined`.
  stage: z
    .enum(['pre', 'post'])
    .nullable()
    .optional()
    .default(null)
    .describe(
      'When to apply the rule. null (the default) is Actual\'s normal stage, the one a rule gets in the UI ' +
        'when no stage is chosen. "pre" runs before the default stage, "post" after. Leave unset unless you ' +
        'specifically need the rule to out-rank or defer to the user\'s existing rules.',
    ),
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

Stage: omit it (the normal stage, recommended), or 'pre' to run before the user's own rules, or 'post' to run after.
Do NOT pass "default" as a string; Actual rejects it. The normal stage is null, which is what omitting gives you.
Action operators: 'set', 'set-split-amount', 'link-schedule', 'append-notes'.

Example (no stage, so the rule lands in the normal stage alongside the user's own rules): {conditionsOp: "and", conditions: [{field: "imported_payee", op: "contains", value: "Amazon"}], actions: [{op: "set", field: "category", value: "category-uuid"}]}`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206).
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
    
    // No automatic translation - require explicit field names
    const ruleData = JSON.parse(JSON.stringify(input)); // deep clone
    
    const ruleId = await adapter.createRule(ruleData);
    return { id: ruleId, success: true };
  },
};

export default tool;
