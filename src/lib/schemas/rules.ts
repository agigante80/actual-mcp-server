import { z } from 'zod';

// #485: the rule input shape and its imperative checks, shared by actual_rules_create and
// actual_rules_create_batch so both accept and reject exactly the same rules with the same
// messages. actual_rules_create_or_update keeps its own copies on purpose (out of scope).

// #486: describe strings shared by the rule tools. Only the TEXT is shared, never the object
// schemas: actual_rules_update keeps its own ActionSchema (op required, no default) and
// actual_rules_create_or_update keeps its own stage (no default, #342), so neither can reuse
// ActionSchema or RuleItemSchema without changing what it accepts.
export const ACTION_DESCRIBE = {
  op: 'One of "set", "set-split-amount", "link-schedule", "prepend-notes", "append-notes"',
  field: 'Field to modify, required for "set": category, payee, notes, cleared, account',
  value: 'Value to assign: a UUID for category, payee and account, text for notes, a number for amounts',
  type: 'Value type hint: "id", "string", "number" or "boolean"',
  options: 'Additional options for the action',
};

export const STAGE_DESCRIBE =
  'null is the normal stage (the UI default), "pre" runs before it, "post" after';

// Operators per field type, for the rule tool descriptions that document conditions.
export const CONDITION_OPERATORS_HELP =
  'Condition operators by field: imported_payee, notes, description (text): contains, matches, doesNotContain, is, isNot. ' +
  'payee, account, category (ids): is, isNot, oneOf, notOneOf. amount: is, gte, lte, gt, lt, isapprox. date: is, gte, lte, gt, lt.';

// Define the schema for rule conditions and actions
export const ConditionSchema = z.object({
  field: z.string().describe('Field to match, e.g. "payee", "notes", "amount", "category"'),
  op: z.string().describe('Operator, e.g. "is", "contains", "gte"'),
  value: z.union([z.string(), z.number()]).describe('Value to match against'),
  type: z.string().optional().describe('Type hint, e.g. "string", "number", "id"'),
});

export const ActionSchema = z.object({
  op: z.string().default('set').describe(`${ACTION_DESCRIBE.op}. Default "set"`),
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

export const RuleItemSchema = z.object({
  // #342: three stages, and the default one is `null`, not a string.
  //
  // Verified against Actual's validator (transaction-rules.ts) and a live server: it
  // accepts exactly 'pre', 'post' and null. The published API reference says
  // pre/default/post, which is wrong (reported upstream as actualbudget/actual#8682).
  // #485: @actual-app/api 26.10.0 changed `fromExternalRule` to convert the string
  // "default" to null, so Actual itself no longer rejects it. That has no behaviour impact
  // here: this enum rejects "default" first, and the tool keeps sending null for the normal
  // stage.
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
    .describe(`${STAGE_DESCRIBE}. Default null; leave unset unless the rule must out-rank or defer to the user's rules`),
  conditionsOp: z.enum(['and', 'or']).optional().default('and').describe('How to combine conditions'),
  conditions: z.array(ConditionSchema).describe('Conditions that must be met'),
  actions: z.array(ActionSchema).describe('Actions to perform when they are met'),
});


export type RuleItem = z.output<typeof RuleItemSchema>;

/**
 * The checks that Zod cannot express, run on a PARSED rule. Throws a plain Error with the
 * message actual_rules_create has always produced. Pure: no I/O.
 */
export function validateRuleInput(input: RuleItem): void {
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
    const fieldInfo = Object.hasOwn(FIELD_OPERATORS, condition.field) ? FIELD_OPERATORS[condition.field] : undefined;
    
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
