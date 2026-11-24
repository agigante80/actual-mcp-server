import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { ACTION_DESCRIBE, ConditionSchema, RuleItemSchema, ActionSchema as CreateActionSchema } from '../../lib/schemas/rules.js';
import { asFields, atLeastOne, needs, strict, strictDeep } from '../refine.js';
import { FULL_SURFACE, type CompactActionRow, type CompactToolSpec, type DescriptionContext } from '../types.js';

/**
 * manage_rules (#677): the compact front for the five rule writers. Selector `action` is
 * required. Nothing here imports the adapter.
 *
 * Mapping (#670 section 7): create -> actual_rules_create, create_batch -> actual_rules_create_batch,
 * upsert -> actual_rules_create_or_update, update -> actual_rules_update (the fields wrapped
 * under `fields`), delete -> actual_rules_delete.
 *
 * WRITE tool: `nullAsAbsent` is NOT set (null is a real stage). NO compact schema carries a
 * `.default()`: the shaped arguments reach the legacy tool, whose own schema applies the legacy
 * defaults (stage null and conditionsOp 'and' on create, op 'set' on a create action). A compact
 * default on update would silently turn an 'or' rule into 'and'.
 *
 * Published schema: LIGHT and without anyOf, because one tools/list entry is capped at 3900 bytes.
 * `conditions`, `actions` and `rules` publish their item keys that identify the shape; the real
 * legacy schemas (ConditionSchema, ActionSchema, RuleItemSchema, and the update-only action that
 * requires `op`) are enforced by the refines below, before any legacy call, with messages that
 * lead with the compact key. Items keep their legacy camelCase keys (`conditionsOp` inside a
 * `create_batch` item); a snake_case key in an item is refused by name instead of being dropped.
 */

const id = z.string().optional().describe('Rule id.');
// `stage` is z.string().nullable().optional() so it publishes type [string, null] with no anyOf;
// the pre/post enum lives in the refine.
const stage = z.string().nullable().optional().describe('null or omitted: normal stage. "pre" runs before the normal stage, "post" after. On update, omit to keep the current stage.');
const conditionsOp = z.enum(['and', 'or']).optional().describe('How conditions combine; default and.');
const condition = z.looseObject({ field: z.string(), op: z.string() });
const conditions = z.array(condition).optional().describe('Items {field, op, value[, type, options]}; options {outflow|inflow} on amount; value: text, number, true or false, array (oneOf, notOneOf) or {num1, num2} (isbetween).');
const action = z.looseObject({ op: z.string().optional(), field: z.string().optional() });
const actions = z.array(action).optional().describe('Items {op, field, value[, type, options]}; op defaults to set on create and upsert, required on update.');
const rules = z
  .array(z.looseObject({ stage: z.string().nullable().optional(), conditionsOp: z.string().optional(), conditions: z.array(condition), actions: z.array(action) }))
  .min(1)
  .max(50)
  .describe('1 to 50 rules, each {stage?, conditionsOp?, conditions, actions} with camelCase keys.');

/** The update action differs from the create one only in that `op` is required (legacy rules_update). */
const UpdateActionSchema = z.object({
  op: z.string().describe(ACTION_DESCRIBE.op),
  field: z.string().optional(),
  value: CreateActionSchema.shape.value,
  type: z.string().optional(),
  options: CreateActionSchema.shape.options,
}).strict(); // #761: an unknown action key is refused, not dropped

const STAGE = z.enum(['pre', 'post']);
const base = {
  id: CommonSchemas.ruleId,
  stage: STAGE,
  conditions: z.array(ConditionSchema),
};
const REAL_WRITE: Readonly<Record<string, z.ZodType>> = { ...base, actions: z.array(CreateActionSchema) };
const REAL_UPDATE: Readonly<Record<string, z.ZodType>> = { ...base, actions: z.array(UpdateActionSchema) };
const REAL_BATCH: Readonly<Record<string, z.ZodType>> = { rules: z.array(RuleItemSchema.strict()).min(1).max(50) };

type V = Record<string, unknown>;

const writeFields = (name: 'create' | 'upsert') =>
  asFields(
    z.object({ stage, conditions_op: conditionsOp, conditions, actions }).superRefine((value, ctx) => {
      needs(name, ctx, value as V, ['conditions', 'actions']);
      strictDeep(ctx, value as V, REAL_WRITE);
    }),
  );
const createFields = writeFields('create');
const upsertFields = writeFields('upsert');
const createBatchFields = asFields(
  z.object({ rules }).superRefine((value, ctx) => strictDeep(ctx, value as V, REAL_BATCH)),
);
const updateFields = asFields(
  z.object({ id, stage, conditions_op: conditionsOp, conditions, actions }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['id']);
    atLeastOne(ctx, value as V, ['stage', 'conditions_op', 'conditions', 'actions']);
    strictDeep(ctx, value as V, REAL_UPDATE);
  }),
);
const deleteFields = asFields(
  z.object({ id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['id']);
    strict(ctx, value as V, base);
  }),
);

/** The published text covers only the actions and sibling tools this server carries (#770); the full surface is the default text. */
function describe(ctx: DescriptionContext): string {
  const a = (name: string) => ctx.hasAction(name);
  const verbs = [
    (a('create') || a('create_batch')) && 'create',
    a('upsert') && 'upsert',
    a('update') && 'change',
    a('delete') && 'delete',
  ].filter((x): x is string => typeof x === 'string');
  const createUpdate = ['create', 'create_batch'].filter(a);
  const updateDelete = ['update', 'delete'].filter(a);
  const returns = [
    ...(a('create') ? ['{ id, success } (create)'] : []),
    ...(a('create_batch') ? ['{ result: { succeeded, failed, total, successCount, failureCount } } (create_batch)'] : []),
    ...(a('upsert') ? ['{ id, created } (upsert)'] : []),
    ...(updateDelete.length > 0 ? [`{ success: true } (${updateDelete.join(', ')})`] : []),
  ];
  const lead = verbs.length > 1 ? `${verbs.slice(0, -1).join(', ')} or ${verbs[verbs.length - 1]}` : verbs.join('');
  return (
    `${lead.charAt(0).toUpperCase()}${lead.slice(1)} budget rules; pick one \`action\`. Writes. ` +
    (ctx.hasTool('list_entities') ? 'To read rules use list_entities with type rule. ' : '') +
    'Other fields are refused.\n' +
    'Conditions match by field and op: imported_payee, payee_name take is, isNot, contains, matches, doesNotContain, and oneOf, notOneOf with an array of text;\nnotes takes is, isNot, contains, matches, doesNotContain;\nid fields (payee, account, category, category_group) take is, isNot, and oneOf, notOneOf with an array of ids; account also onBudget, offBudget (value "");\ncleared, reconciled take is with true or false;\namount takes is, isapprox, isbetween ({num1, num2} cents), gt, gte, lt, lte;\ndate takes is, isapprox, gt, gte, lt, lte. notes and payee_name also take hasTags (all) and hasAnyTag (any): value "#a #b", whole tags, any case.\nOther condition fields are refused. Ids must exist or the call is refused and nothing is written (ids in link-schedule actions and category_group conditions are not checked).\n' +
    (createUpdate.includes('create') ? 'create: conditions, actions; optional stage, conditions_op.\n' : '') +
    (a('create_batch') ? 'create_batch: rules (1 to 50, items with camelCase keys); NOT atomic, no rollback: a failing rule is reported in failed and the rest are still attempted; if the call itself fails, read the rules back before retrying.\n' : '') +
    (a('upsert') ? 'upsert: conditions, actions; optional stage, conditions_op; a rule with the same conditions and conditions_op (any order) has its actions replaced and its stage replaced only if sent, else a rule is created.\n' : '') +
    (a('update') ? 'update: id and at least one of stage, conditions_op, conditions, actions; unsent fields stay.\n' : '') +
    (a('delete') ? `delete: id; DESTRUCTIVE, cannot be undone; a rule owned by a schedule is refused${ctx.hasTool('manage_schedules') ? ' (use manage_schedules delete)' : ''}; an unknown id is refused.\n` : '') +
    `Returns ${returns.join(', ')}.`
  );
}

export const manageRules: CompactToolSpec = {
  name: 'manage_rules',
  domain: 'Changing data',
  summary: 'Create, upsert, change or delete the rules that categorize imported transactions.',
  examplePrompt: 'Make a rule that files every Spotify transaction under Subscriptions.',
  description: describe(FULL_SURFACE),
  describeFor: describe,
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_rules_create', fields: createFields, rename: { conditions_op: 'conditionsOp' } }],
    ['create_batch', { legacy: 'actual_rules_create_batch', fields: createBatchFields }],
    ['upsert', { legacy: 'actual_rules_create_or_update', fields: upsertFields, rename: { conditions_op: 'conditionsOp' } }],
    ['update', { legacy: 'actual_rules_update', fields: updateFields, rename: { conditions_op: 'conditionsOp' }, wrap: { into: 'fields', top: ['id'] } }],
    ['delete', { legacy: 'actual_rules_delete', fields: deleteFields }],
  ]),
};
