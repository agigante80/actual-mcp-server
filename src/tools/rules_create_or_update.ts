/**
 * actual_rules_create_or_update
 *
 * Idempotent rule upsert: create a rule if none with matching conditions exists,
 * or update the existing one in place. Prevents duplicate rules when an AI client
 * retries or regenerates the same rule creation request.
 *
 * Matching logic: a rule is considered a "match" when it has the same set of
 * (field, op, value) triples AND the same conditionsOp ("and"/"or"). Order of
 * conditions in the array is irrelevant — the comparison is set-based.
 *
 * Concept and implementation adapted from the ZanzyTHEbar fork:
 * https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/rules_create_or_update.ts
 * Credit: ZanzyTHEbar (https://github.com/ZanzyTHEbar)
 *
 * Adapted for this project's conventions:
 * - No wrapToolCall: uses the direct call() pattern
 * - Reuses the exact same ConditionSchema / ActionSchema / FIELD_OPERATORS as rules_create.ts
 *
 * #376: the read-match-write cycle lives in `adapter.upsertRule` (identity rules in
 * `src/lib/rule-matching.ts`). This tool owns the schema, the operator/UUID validation and
 * the response. It used to run the cycle itself inside `withWriteSession` with raw api
 * calls, which meant no `retry` on the read and a second observability blind spot.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

// Mirrors the same schemas used in rules_create.ts
const ConditionSchema = z.object({
  field: z.string().describe('Field to match (e.g., "payee", "notes", "amount", "category", "imported_payee")'),
  op: z.string().describe('Operation (e.g., "is", "contains", "isapprox", "gte", "lte")'),
  value: z.union([z.string(), z.number()]).describe('Value to match against'),
  type: z.string().optional().describe('Type of condition (e.g., "string", "number", "id")'),
});

const ActionSchema = z.object({
  op: z.string()
    .default('set')
    .describe('Operation to perform. Options: "set" (default), "set-split-amount", "link-schedule", "prepend-notes", "append-notes"'),
  field: z.string()
    .optional()
    .describe('Field to modify — required for "set" op. Options: "category", "payee", "notes", "cleared", "account"'),
  value: z.union([z.string(), z.number(), z.boolean(), z.object({}).passthrough()])
    .describe('Value to assign. Use UUIDs for id-type fields, text for strings, numbers for amounts'),
  type: z.string()
    .optional()
    .describe('Value type hint: "id", "string", "number", "boolean"'),
  options: z.object({}).passthrough().optional().describe('Additional options for the action'),
});

// Same operator validation map as rules_create.ts
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
  // #342: see the long note in rules_create.ts. null is Actual's DEFAULT stage;
  // the literal "default" is rejected by the validator. No .default() here on
  // purpose: this tool upserts, so "not supplied" must mean "leave the matched
  // rule's stage alone", which is decided at the merge below. The create path
  // supplies null explicitly.
  stage: z
    .enum(['pre', 'post'])
    .nullable()
    .optional()
    .describe(
      'When to apply the rule. null is Actual\'s normal stage (what the UI gives a rule with no stage chosen); ' +
        '"pre" runs before it, "post" after. On an update, omitting this leaves the existing stage unchanged.',
    ),
  conditionsOp: z.enum(['and', 'or']).optional().default('and').describe('How to combine multiple conditions'),
  conditions: z.array(ConditionSchema).describe('Array of conditions that must be met'),
  actions: z.array(ActionSchema).describe('Array of actions to perform when conditions match'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_create_or_update',
  description: `Create a rule if no matching rule exists, or update the existing rule if one with the same conditions already exists. Prevents duplicate rules.

Matching logic: a rule is considered a "match" when it has the same set of conditions (field + op + value triples) and the same conditionsOp ("and"/"or"). Condition order is irrelevant.

When a match is found: the rule's actions are REPLACED with the new values. The stage is replaced ONLY if you
supply one; omit stage to leave the matched rule in whatever stage it is already in. On a newly created rule,
an omitted stage means the normal stage (null), the same one the UI assigns.
When no match exists: a new rule is created.

IMPORTANT Field Types:
- "imported_payee" (string) — text matching. Supports: contains, matches, doesNotContain, is, isNot
- "payee" (ID) — exact payee UUID. Supports: is, isNot, oneOf, notOneOf
- "account", "category" (ID) — UUID matching. Supports: is, isNot, oneOf, notOneOf
- "notes", "description" (string) — text matching. Supports: contains, matches, doesNotContain, is, isNot
- "amount", "date" (number/date) — supports: is, gte, lte, gt, lt

Returns: { id, created: boolean } — created=true if new rule was created, false if existing rule was updated.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206).
    const input = InputSchema.parse(args || {});

    // ── Validate conditions ──
    for (const condition of input.conditions) {
      const fieldInfo = FIELD_OPERATORS[condition.field];
      if (fieldInfo && !fieldInfo.operators.includes(condition.op)) {
        throw new Error(
          `Invalid operator "${condition.op}" for field "${condition.field}". ` +
          `Field "${condition.field}" is a ${fieldInfo.type} field and only supports: ${fieldInfo.operators.join(', ')}.`,
        );
      }
      if (condition.field === 'payee' && typeof condition.value === 'string' && !condition.value.match(/^[0-9a-f-]{36}$/i)) {
        throw new Error(
          `Field "payee" expects a UUID, but got "${condition.value}". ` +
          `Use "imported_payee" for text matching instead.`,
        );
      }
      if (['account', 'category'].includes(condition.field) && typeof condition.value === 'string' && !condition.value.match(/^[0-9a-f-]{36}$/i)) {
        throw new Error(`Field "${condition.field}" expects a UUID, but got text "${condition.value}".`);
      }
      if (['oneOf', 'notOneOf'].includes(condition.op) && !Array.isArray(condition.value)) {
        throw new Error(`Operator "${condition.op}" expects an array of values.`);
      }
    }

    // ── Validate actions ──
    for (const action of input.actions) {
      if (action.op === 'set' && !action.field) {
        throw new Error('Action with op="set" requires a "field" property.');
      }
      if (action.op === 'set' && action.field) {
        for (const idField of ['category', 'payee', 'account'] as const) {
          if (action.field === idField && typeof action.value === 'string' && !action.value.match(/^[0-9a-f-]{36}$/i)) {
            throw new Error(`Action field "${idField}" expects a UUID, but got "${action.value}".`);
          }
        }
      }
      if (['append-notes', 'prepend-notes'].includes(action.op) && typeof action.value !== 'string') {
        throw new Error(`Action "${action.op}" requires a string value.`);
      }
    }

    // The read, the match and the write happen in ONE write-queue cycle inside
    // adapter.upsertRule (#142, relocated in #376).
    //
    // `stage` is passed as an explicit presence flag rather than relying on the key being
    // present on the parsed object: null is a MEANINGFUL stage (Actual's default), so
    // "omitted" and "explicitly null" must stay distinguishable across the call boundary
    // (#342).
    return await adapter.upsertRule(
      {
        stage: input.stage,
        conditionsOp: input.conditionsOp,
        conditions: input.conditions,
        actions: input.actions,
      },
      Object.prototype.hasOwnProperty.call((args ?? {}) as object, 'stage'),
    );
  },
};

export default tool;
