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
 * - Shares ConditionSchema and (#711) the operator check assertConditionOperator with
 *   rules_create.ts (src/lib/schemas/rules.ts); ActionSchema is the shared strict one (#761)
 *
 * #376: the read-match-write cycle lives in `adapter.upsertRule` (identity rules in
 * `src/lib/rule-matching.ts`). This tool owns the schema, the operator/UUID validation and
 * the response. It used to run the cycle itself inside `withWriteSession` with raw api
 * calls, which meant no `retry` on the read and a second observability blind spot.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { ActionSchema, CONDITION_OPERATORS_HELP, ConditionSchema, STAGE_DESCRIBE, assertConditionOperator, assertConditionOptions, assertConditionValue, assertRuleLists, assertSetActionValue, assertTagOperatorValue, isTextOnIdField } from '../lib/schemas/rules.js';

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
    .describe(`${STAGE_DESCRIBE}. On an update, omitting this leaves the existing stage unchanged`),
  conditionsOp: z.enum(['and', 'or']).optional().default('and').describe('How to combine conditions'),
  conditions: z.array(ConditionSchema).describe('Conditions that must be met'),
  actions: z.array(ActionSchema).describe('Actions to perform when they are met'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_create_or_update',
  description: `Create a rule, or update the existing rule with the same conditions.

A rule matches when it has the same conditions (field, op, value) and conditionsOp, in any order. On a match the rule's actions are REPLACED, and its stage is replaced ONLY if you supply one (omit stage to leave it). A new rule with no stage gets the normal stage (null).

${CONDITION_OPERATORS_HELP}

Returns: { id, created }, created true for a new rule, false for an updated one.`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206).
    const input = InputSchema.parse(args || {});

    // #762: both lists must hold at least one item.
    assertRuleLists(input);

    // ── Validate conditions ──
    for (const condition of input.conditions) {
      assertConditionOperator(condition);
      assertTagOperatorValue(condition);
      assertConditionValue(condition);
      assertConditionOptions(condition);
      if (!isTextOnIdField(condition)) continue;
      if (condition.field === 'payee') {
        throw new Error(
          `Field "payee" expects a UUID, but got "${condition.value}". ` +
          `Use "imported_payee" for text matching instead.`,
        );
      }
      throw new Error(`Field "${condition.field}" expects a UUID, but got text "${condition.value}".`);
    }

    // ── Validate actions ──
    for (const action of input.actions) {
      assertSetActionValue(action);
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
    // `stage` is passed as an explicit presence flag, because null is a MEANINGFUL stage
    // (Actual's default) and "omitted" must stay distinguishable from "explicitly null"
    // across the call boundary (#342).
    //
    // Derived from the PARSED value, not from `hasOwnProperty` on the raw args. The schema
    // is `.nullable().optional()` with no default, so `undefined` means omitted and `null`
    // means the default stage; a raw-args key test would call an explicit
    // `{ stage: undefined }` "supplied" and send `undefined` into the update, which is the
    // exact value #342 records Actual rejecting with `Invalid rule stage: undefined`.
    // Unreachable over JSON-RPC (which cannot carry undefined) but reachable in-process.
    return await adapter.upsertRule(
      {
        stage: input.stage,
        conditionsOp: input.conditionsOp,
        conditions: input.conditions,
        actions: input.actions,
      },
      input.stage !== undefined,
    );
  },
};

export default tool;
