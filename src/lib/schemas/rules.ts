import { z } from 'zod';

// #485: the rule input shape and its imperative checks, shared by actual_rules_create and
// actual_rules_create_batch so both accept and reject exactly the same rules with the same
// messages. #711: the condition operator check (CONDITION_FIELD_OPERATORS and
// assertConditionOperator) is shared by all four rule write tools.

// #486: describe strings shared by the rule tools. Only the TEXT is shared, never the object
// schemas: actual_rules_update keeps its own ActionSchema (op required, no default) and
// actual_rules_create_or_update keeps its own stage (no default, #342), so neither can reuse
// ActionSchema or RuleItemSchema without changing what it accepts.
export const ACTION_DESCRIBE = {
  op: 'One of set, set-split-amount, link-schedule, prepend-notes, append-notes',
  field: 'Field to modify, required for set: category, payee, notes, cleared, account',
  value: 'Value to assign: a UUID for category, payee and account, text for notes, a number for amounts',
  type: 'Value type hint: id, string, number or boolean',
  options: 'Additional options for the action',
};

export const STAGE_DESCRIBE =
  'null is the normal stage (the UI default), "pre" runs before it, "post" after';

// Operators per field, for the rule tool descriptions that document conditions. #711: it states
// CONDITION_FIELD_OPERATORS below; change both together.
export const CONDITION_OPERATORS_HELP =
  'Conditions: imported_payee, payee_name (text): is, isNot, contains, matches, doesNotContain, oneOf, notOneOf (array of text). ' +
  'notes: is, isNot, contains, matches, doesNotContain. notes and payee_name also hasTags (all), hasAnyTag (any): value "#a #b", whole tags, any case. ' +
  'payee, account, category, category_group (ids): is, isNot, oneOf, notOneOf (array of ids); account also onBudget, offBudget (value ""). ' +
  'amount: is, isapprox, isbetween ({num1, num2} cents), gt, gte, lt, lte. date: is, isapprox, gt, gte, lt, lte. ' +
  'cleared, reconciled, transfer, parent: is true or false.';

/**
 * #711: the ONE condition operator map, used by every rule write tool. It equals the tables of
 * the installed @actual-app/api (TYPE_INFO and FIELD_INFO in its dist), which
 * tests/unit/rules_operator_drift.test.js reads and compares on every unit run, with two
 * recorded exceptions (kept in that test's EXCEPTIONS table, with the reasons):
 *   - `saved` is omitted: its type has no operators upstream.
 *   - contains, matches and doesNotContain stay refused on payee, account, category and
 *     category_group. Upstream accepts them, but a rule compares the raw id, so such a rule is
 *     saved and never fires.
 * A field that is not a key here is refused ("Unknown condition field"); `description` is not
 * an upstream condition field and was never one.
 */
export const CONDITION_FIELD_OPERATORS: Readonly<Record<string, { readonly type: string; readonly operators: readonly string[] }>> = {
  imported_payee: { type: 'string', operators: ['is', 'isNot', 'contains', 'matches', 'doesNotContain', 'oneOf', 'notOneOf'] },
  payee: { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf'] },
  payee_name: { type: 'string', operators: ['is', 'isNot', 'contains', 'matches', 'doesNotContain', 'oneOf', 'notOneOf', 'hasTags', 'hasAnyTag'] },
  account: { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf', 'onBudget', 'offBudget'] },
  category: { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf'] },
  category_group: { type: 'id', operators: ['is', 'isNot', 'oneOf', 'notOneOf'] },
  notes: { type: 'string', operators: ['is', 'isNot', 'contains', 'matches', 'doesNotContain', 'hasTags', 'hasAnyTag'] },
  amount: { type: 'number', operators: ['is', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte'] },
  date: { type: 'date', operators: ['is', 'isapprox', 'gt', 'gte', 'lt', 'lte'] },
  cleared: { type: 'boolean', operators: ['is'] },
  reconciled: { type: 'boolean', operators: ['is'] },
  transfer: { type: 'boolean', operators: ['is'] },
  parent: { type: 'boolean', operators: ['is'] },
};

const TEXT_OPERATORS: ReadonlySet<string> = new Set(['contains', 'matches', 'doesNotContain']);

/**
 * #711: refuse an unknown field, or an operator its field does not take. Call it FIRST, before
 * assertTagOperatorValue and assertConditionValue, so a wrong operator is named as such.
 */
export function assertConditionOperator(condition: { field: string; op: string }): void {
  const { field, op } = condition;
  const info = Object.hasOwn(CONDITION_FIELD_OPERATORS, field) ? CONDITION_FIELD_OPERATORS[field] : undefined;
  if (!info) {
    throw new Error(`Unknown condition field "${field}". Valid fields: ${Object.keys(CONDITION_FIELD_OPERATORS).join(', ')}.`);
  }
  if (info.operators.includes(op)) return;
  let hint = '';
  if (info.type === 'id' && TEXT_OPERATORS.has(op)) {
    hint = field === 'payee'
      ? ' To match by name use "payee_name" or "imported_payee".'
      : ' This field holds an id, so a text operator never matches in a rule.';
  }
  throw new Error(
    `Invalid operator "${op}" for field "${field}". ` +
    `Field "${field}" is a ${info.type} field and only supports: ${info.operators.join(', ')}.${hint}`
  );
}

/**
 * #703: `hasTags` and `hasAnyTag` take one string of tags separated by whitespace or "#".
 * Upstream accepts a value with no tag in it ("#", "   "). When rules run, `hasTags` with no
 * tag is then true for EVERY transaction that has notes (and `hasAnyTag` for none), so the
 * rule would act on everything. Do not relax this refusal. Call it AFTER the operator check, so a tag operator on a field that
 * does not take it gets the "Invalid operator" refusal instead.
 */
export function assertTagOperatorValue(condition: { field: string; op: string; value?: unknown }): void {
  if (condition.op !== 'hasTags' && condition.op !== 'hasAnyTag') return;
  if (typeof condition.value === 'string' && /[^#\s]/.test(condition.value)) return;
  throw new Error(
    `Operator "${condition.op}" needs at least one tag in its value, for example "#trip" (field: ${condition.field}). Nothing was written.`
  );
}

const ARRAY_OPERATORS: ReadonlySet<string> = new Set(['oneOf', 'notOneOf']);
const BOOLEAN_FIELDS: ReadonlySet<string> = new Set(['cleared', 'reconciled', 'transfer', 'parent']);
const ID_FIELDS: ReadonlySet<string> = new Set(['payee', 'account', 'category', 'category_group']);
const UUID_SHAPE = /^[0-9a-f-]{36}$/i;
// #711: account onBudget and offBudget test the account's budget flag and take no id.
const NO_VALUE_OPERATORS: ReadonlySet<string> = new Set(['onBudget', 'offBudget']);
const PLURAL: Readonly<Record<string, string>> = { category: 'categories', category_group: 'category groups' };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * #711: true when an id field (payee, account, category, category_group) carries a single text
 * value that is not a UUID, on an operator that compares ids. Each tool words its own refusal.
 */
export function isTextOnIdField(condition: { field: string; op: string; value?: unknown }): condition is { field: string; op: string; value: string } {
  return ID_FIELDS.has(condition.field) &&
    !NO_VALUE_OPERATORS.has(condition.op) &&
    typeof condition.value === 'string' &&
    !UUID_SHAPE.test(condition.value);
}

/** The plural a refusal uses to tell the caller what to list. */
export const idFieldPlural = (field: string): string => PLURAL[field] ?? `${field}s`;

/**
 * #710: which KIND of value a condition may carry, shared by the three rule validators
 * (validateRuleInput here, actual_rules_update, actual_rules_create_or_update) so they refuse
 * the same input with the same words. Call it AFTER the operator check.
 *
 * Two refusals are deliberately stricter than upstream, which accepts both: an empty array
 * (`notOneOf []` matches every transaction, `oneOf []` none) and an array on a single-value
 * operator (it never matches anything). Do not relax them.
 */
export function assertConditionValue(condition: { field: string; op: string; value?: unknown }): void {
  const { field, op, value } = condition;
  // #711: isbetween takes a range object, and only isbetween does.
  if (op === 'isbetween') {
    if (!isPlainObject(value) || !Number.isInteger(value.num1) || !Number.isInteger(value.num2)) {
      throw new Error(
        `Operator "isbetween" requires {num1, num2} in integer cents, for example {"num1": 1000, "num2": 5000} (field: ${field}).`
      );
    }
    return;
  }
  if (isPlainObject(value)) {
    throw new Error(`Only "isbetween" takes a {num1, num2} value (field: ${field}, op: ${op}).`);
  }
  if (ARRAY_OPERATORS.has(op)) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(
        `Operator "${op}" requires a non-empty array of values (field: ${field}). ` +
        `Example: {field: "${field}", op: "${op}", value: ["uuid-1", "uuid-2"]}`
      );
    }
    // An empty element is dropped upstream (filter(Boolean)), which would turn notOneOf [""] into
    // the match-everything empty list refused above. A repeated element would make the same set
    // of ids two different rules for the upsert match.
    if (value.some((element) => typeof element !== 'string' || element.trim() === '')) {
      throw new Error(`Operator "${op}" does not accept an empty value in its array (field: ${field}).`);
    }
    const repeated = value.find((element, index) => value.indexOf(element) !== index);
    if (repeated !== undefined) {
      throw new Error(`Operator "${op}" lists "${String(repeated)}" more than once (field: ${field}).`);
    }
    if (ID_FIELDS.has(field)) {
      const bad = value.find((element) => typeof element !== 'string' || !UUID_SHAPE.test(element));
      if (bad !== undefined) {
        throw new Error(
          `Field "${field}" expects IDs (UUIDs) with operator "${op}", but the array holds "${String(bad)}". ` +
          `List the ${idFieldPlural(field)} to find the correct UUIDs.`
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    throw new Error(
      `Operator "${op}" does not accept an array (field: ${field}). Use "oneOf" or "notOneOf" for a list of values.`
    );
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof value !== 'boolean') {
      throw new Error(`Field "${field}" must be true or false with operator "${op}", but got ${typeof value}.`);
    }
  } else if (typeof value === 'boolean') {
    throw new Error(`Field "${field}" does not accept a boolean value (operator: ${op}).`);
  }
}

/**
 * #761: the checks on a condition's `options`, shared by the four write paths (validateRuleInput,
 * actual_rules_update, actual_rules_create_or_update). Runs on INPUT only, never on a stored rule:
 * upstream stores `options` on any field without complaint, so a stored one must stay readable.
 * The key names and booleans are checked by ConditionSchema.
 */
export function assertConditionOptions(condition: { field: string; op?: string; value?: unknown; options?: { outflow?: boolean; inflow?: boolean } }): void {
  const options = condition.options;
  if (options === undefined) return;
  if (condition.field !== 'amount') throw new Error('options is only valid on an amount condition');
  if (options.outflow === true && options.inflow === true) throw new Error('options cannot set both outflow and inflow');
  if (options.outflow !== true && options.inflow !== true) return;
  const { value } = condition;
  const amounts = isPlainObject(value) ? [value.num1, value.num2] : [value];
  if (amounts.some((amount) => typeof amount === 'number' && amount < 0)) {
    throw new Error('an amount condition with outflow or inflow takes a positive value; the direction comes from the option');
  }
}

// Define the schema for rule conditions and actions
export const ConditionSchema = z.object({
  field: z.string().describe('Field to match'),
  op: z.string().describe('Operator'),
  // #710: one flat union. Which kind a given field and operator takes is enforced by
  // assertConditionValue, not here: a nested schema per operator would publish oneOf.
  // #711: the object member is the isbetween range. Integer cents are checked in
  // assertConditionValue, not with .int() here: .int() publishes a minimum and maximum per bound
  // in every rule tool's schema, which the tools/list size budget does not have room for.
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.object({ num1: z.number().describe('Cents'), num2: z.number().describe('Cents') }),
    ])
    .describe('Value; an array for oneOf, notOneOf; {num1, num2} for isbetween'),
  type: z.string().optional().describe('Type hint, e.g. string, number, id'),
  // #761: the direction of an amount condition. Strict (an unknown key inside is refused) and the
  // object is strict too, so a stray key is refused by name instead of being dropped.
  options: z
    .object({
      outflow: z.boolean().optional().describe('Outflows'),
      inflow: z.boolean().optional().describe('Inflows'),
    })
    .strict()
    .optional()
    .describe('amount only; outflow or inflow, not both'),
}).strict();

export const ActionSchema = z.object({
  op: z.string().default('set').describe(`${ACTION_DESCRIBE.op}. Default set`),
  field: z.string().optional().describe(ACTION_DESCRIBE.field),
  value: z.union([z.string(), z.number(), z.boolean(), z.object({}).passthrough()]).describe(ACTION_DESCRIBE.value),
  type: z.string().optional().describe(ACTION_DESCRIBE.type),
  options: z.object({}).passthrough().optional().describe(ACTION_DESCRIBE.options),
}).strict();

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
    assertConditionOperator(condition);
    assertTagOperatorValue(condition);
    assertConditionValue(condition);
    assertConditionOptions(condition);
    
    // Check if using payee field with text value instead of ID
    if (!isTextOnIdField(condition)) continue;
    if (condition.field === 'payee') {
      throw new Error(
        `Field "payee" expects a payee ID (UUID), but got text value "${condition.value}". ` +
        `To match payee names with text, use "imported_payee" field instead. ` +
        `Example: {field: "imported_payee", op: "contains", value: "${condition.value}"}`
      );
    }
    // account, category and (since #711) category_group
    throw new Error(
      `Field "${condition.field}" expects an ID (UUID), but got text value "${condition.value}". ` +
      `Use the ${condition.field} UUID from your budget data. List ${idFieldPlural(condition.field)} to find the correct UUID.`
    );
  }
}
