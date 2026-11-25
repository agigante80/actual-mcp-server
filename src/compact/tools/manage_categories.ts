import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { AUTOMATION_TYPES, EDITOR_AUTOMATIONS } from '../../lib/schemas/automations.js';
import { asFields, atLeastOne, needs, strict, strictDeep } from '../refine.js';
import { FULL_SURFACE, type CompactActionRow, type CompactRoute, type CompactToolSpec, type DescriptionContext } from '../types.js';

/**
 * manage_categories (#676): the compact front for the six category and category-group writers
 * plus the category side of notes. Selector `action` is required. Nothing here imports the
 * adapter: the dispatcher reaches Actual only through callOperation (#671).
 *
 * Mapping (#670 section 7): create -> actual_categories_create, or actual_category_groups_create
 * (entity category_group); update -> actual_categories_update, or actual_category_groups_update;
 * delete -> actual_categories_delete, or actual_category_groups_delete; set_note ->
 * actual_notes_update (shared with the other manage_* tools, allowed in the parity test only
 * from the action set_note).
 *
 * WRITE tool: `nullAsAbsent` is NOT set. `entity` is consumed here and never forwarded.
 * `hidden` exists only for a category group on create (the legacy category tool has none);
 * `group_id` only for a category. Shared keys are ONE light optional schema object each; the
 * strict formats and required-ness are enforced by the per-target refines (see manage_accounts).
 */

const entity = z.enum(['category', 'category_group']).optional().describe('category or category_group.');
const id = z.string().optional().describe('Category id (category group id with entity category_group).');
const name = z.string().optional().describe('Name, 1 to 255 characters.');
const groupId = z.string().optional().describe('Category group id.');
const isIncome = z.boolean().optional().describe('Income flag; default expense (a category: its group\'s).');
const hidden = z.boolean().optional().describe('Hidden flag.');
const note = z.string().optional().describe('Note text; "" clears it.');

const CATEGORY_REAL: Readonly<Record<string, z.ZodType>> = {
  id: CommonSchemas.categoryId,
  name: CommonSchemas.name,
  group_id: CommonSchemas.categoryGroupId,
};
const GROUP_REAL: Readonly<Record<string, z.ZodType>> = { ...CATEGORY_REAL, id: CommonSchemas.categoryGroupId };

type V = Record<string, unknown>;

const createFields = asFields(
  z.object({ entity, name, group_id: groupId, is_income: isIncome }).superRefine((value, ctx) => {
    needs('create', ctx, value as V, ['entity', 'name', 'group_id']);
    strict(ctx, value as V, CATEGORY_REAL);
  }),
);
const createGroupFields = asFields(
  z.object({ entity, name, is_income: isIncome, hidden }).superRefine((value, ctx) => {
    needs('create', ctx, value as V, ['entity', 'name']);
    strict(ctx, value as V, GROUP_REAL);
  }),
);
const updateFields = asFields(
  z.object({ entity, id, name, group_id: groupId, is_income: isIncome, hidden }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, CATEGORY_REAL);
    atLeastOne(ctx, value as V, ['name', 'group_id', 'is_income', 'hidden']);
  }),
);
const updateGroupFields = asFields(
  z.object({ entity, id, name, is_income: isIncome, hidden }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, GROUP_REAL);
    atLeastOne(ctx, value as V, ['name', 'is_income', 'hidden']);
  }),
);
const deleteFields = asFields(
  z.object({ entity, id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, CATEGORY_REAL);
  }),
);
const deleteGroupFields = asFields(
  z.object({ entity, id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, GROUP_REAL);
  }),
);
const noteFields = asFields(
  z.object({ id, note }).superRefine((value, ctx) => {
    needs('set_note', ctx, value as V, ['id', 'note']);
    strict(ctx, value as V, CATEGORY_REAL);
  }),
);

// #842 (experimental feature budget_automations): the automations save. Light published keys; the
// strict per-type schema runs in the refine, and the adapter parses again.
const automations = z
  .array(z.object({ type: z.enum(AUTOMATION_TYPES) }).passthrough())
  .max(50)
  .optional()
  .describe('set_automations: the full list (replaces the stored one); entries as get_automations returns, money in integer minor units.');
const confirmNoteSwitch = z.boolean().optional().describe('set_automations: true confirms switching a note-managed category to the editor.');
const setAutomationsFields = asFields(
  z.object({ id, automations, confirm_note_switch: confirmNoteSwitch }).superRefine((value, ctx) => {
    needs('set_automations', ctx, value as V, ['id', 'automations']);
    strict(ctx, value as V, CATEGORY_REAL);
    strictDeep(ctx, value as V, { automations: EDITOR_AUTOMATIONS });
  }),
);

const groupRoute = (legacy: string, fields: CompactActionRow['fields']): CompactRoute => ({
  triggers: ['entity'],
  when: (call) => call.entity === 'category_group',
  triggerValue: 'category_group',
  legacy,
  fields,
  drop: ['entity'],
});
const wrapped = { into: 'fields', top: ['id'] } as const;
const groupWrapped = (legacy: string, fields: CompactActionRow['fields']): CompactRoute => ({ ...groupRoute(legacy, fields), wrap: wrapped });

/** The published text covers only the actions this server carries (#770); with set_automations unpublished it is exactly the text before #842. */
function describe(ctx: DescriptionContext): string {
  const auto = ctx.hasAction('set_automations');
  return (
    'Create, change, delete or annotate budget categories and category groups; pick one `action`. Writes. ' +
    'To read or find ids use list_entities; budget amounts and month notes belong to manage_budget_months. Other fields are refused. ' +
    'entity (category or category_group) is required for create, update and delete. ' +
    'create: entity, name; a category also needs group_id (an unknown group is refused as not found) and takes is_income from that group (a different is_income is refused); a category_group may set is_income (true is refused when the budget already has an income group) and hidden. ' +
    'update: entity, id and at least one of name, group_id (category only; an unknown group is refused), is_income, hidden; is_income must match the group, so moving a category to a group with the other is_income needs both; prefer hidden true over delete to retire a category. ' +
    'delete: entity, id; DESTRUCTIVE, cannot be undone: a category is removed and its transactions are not moved (recategorize them first); deleting a group ALSO deletes every category in it (move them out first with update group_id). ' +
    'set_note: id (a category or category group UUID), note ("" clears); not budget-YYYY-MM; an account note goes through manage_accounts and a payee note through manage_payees. ' +
    (auto
      ? 'set_automations (experimental): id, automations (the full list, replaces the stored one; types periodic, limit, refill, percentage, average, by, remainder, goal, schedule, as get_automations returns them; money in integer minor units), confirm_note_switch (needed when the category uses #template, #goal or #cleanup notes); needs Goal templates and the automations editor on; cleanup is never changed; a schedule entry is matched by name, so renaming the schedule breaks it. '
      : '') +
    'Returns { success, categoryId, message } (create category), { id, success } (create group), { success } (update, delete), { result: { success, id, note, cleared } } (set_note)' +
    (auto ? ', { result: { categoryId, source, automations, errors, cleanup, verified } } (set_automations; verified false: re-read it)' : '') +
    '.'
  );
}

export const manageCategories: CompactToolSpec = {
  name: 'manage_categories',
  domain: 'Changing data',
  summary: 'Create, change, delete or annotate budget categories and category groups.',
  examplePrompt: 'Create a Pets category in the Everyday group.',
  description: describe(FULL_SURFACE),
  describeFor: describe,
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_categories_create', fields: createFields, drop: ['entity'], routes: [groupRoute('actual_category_groups_create', createGroupFields)] }],
    ['update', { legacy: 'actual_categories_update', fields: updateFields, drop: ['entity'], wrap: wrapped, routes: [groupWrapped('actual_category_groups_update', updateGroupFields)] }],
    ['delete', { legacy: 'actual_categories_delete', fields: deleteFields, drop: ['entity'], routes: [groupRoute('actual_category_groups_delete', deleteGroupFields)] }],
    ['set_note', { legacy: 'actual_notes_update', fields: noteFields }],
    ['set_automations', { legacy: 'actual_categories_set_automations', fields: setAutomationsFields, rename: { id: 'categoryId', confirm_note_switch: 'confirmNoteSwitch' } }],
  ]),
};
