import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { asFields, atLeastOne, needs, strict } from '../refine.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * manage_payees (#676): the compact front for the four payee writers plus the payee side of
 * notes. Selector `action` is required. Nothing here imports the adapter.
 *
 * Mapping (#670 section 7): create -> actual_payees_create, update -> actual_payees_update,
 * delete -> actual_payees_delete, merge -> actual_payees_merge, set_note -> actual_notes_update
 * (shared with the other manage_* tools, allowed in the parity test only from set_note).
 *
 * WRITE tool: `nullAsAbsent` is NOT set, because `category: null` clears the payee's default
 * category and is forwarded as null. `update` inherits the legacy behaviour unchanged,
 * including open bug #651 (category is stored as a payee rule); this ticket neither fixes
 * nor works around it. A merge whose target is also a source is refused by the adapter, not here.
 *
 * Shared keys are ONE light optional schema object each; the strict formats and required-ness
 * are enforced by the per-target refines (see manage_accounts). `category` is the only key
 * that publishes `type: [string, "null"]`; it carries no extra constraint so Zod emits no anyOf,
 * and its UUID format is checked in the refine.
 */

const id = z.string().optional().describe('Payee id.');
const name = z.string().optional().describe('Name, 1 to 255 characters.');
const notes = z.string().optional().describe('Notes, up to 1000 characters.');
const transferAcct = z.string().optional().describe('Account id when the payee stands for a transfer.');
const category = z.string().nullable().optional().describe('Default category id; null clears it.');
const targetId = z.string().optional().describe('Payee that is kept.');
const mergeIds = z.array(z.string()).optional().describe('1 to 50 payee ids merged into target_id.');
const note = z.string().optional().describe('Note text; "" clears it.');

const REAL: Readonly<Record<string, z.ZodType>> = {
  id: CommonSchemas.payeeId,
  name: CommonSchemas.name,
  notes: z.string().max(1000, 'Notes cannot exceed 1000 characters'),
  transfer_acct: CommonSchemas.accountId,
  category: CommonSchemas.categoryId,
  target_id: CommonSchemas.payeeId,
  merge_ids: z.array(CommonSchemas.payeeId).min(1).max(50),
};

type V = Record<string, unknown>;

const createFields = asFields(
  z.object({ name, notes }).superRefine((value, ctx) => {
    needs('create', ctx, value as V, ['name']);
    strict(ctx, value as V, REAL);
  }),
);
const updateFields = asFields(
  z.object({ id, name, transfer_acct: transferAcct, category }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['id']);
    strict(ctx, value as V, REAL);
    atLeastOne(ctx, value as V, ['name', 'transfer_acct', 'category']);
  }),
);
const deleteFields = asFields(
  z.object({ id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['id']);
    strict(ctx, value as V, REAL);
  }),
);
const mergeFields = asFields(
  z.object({ target_id: targetId, merge_ids: mergeIds }).superRefine((value, ctx) => {
    needs('merge', ctx, value as V, ['target_id', 'merge_ids']);
    strict(ctx, value as V, REAL);
  }),
);
const noteFields = asFields(
  z.object({ id, note }).superRefine((value, ctx) => {
    needs('set_note', ctx, value as V, ['id', 'note']);
    strict(ctx, value as V, REAL);
  }),
);

export const managePayees: CompactToolSpec = {
  name: 'manage_payees',
  domain: 'Changing data',
  summary: 'Create, change, delete, merge or annotate payees.',
  examplePrompt: 'Merge the payees Costco and Costco Wholesale.',
  description:
    'Create, change, delete, merge or annotate payees; pick one `action`. Writes. ' +
    'To read or find ids use list_entities. Other fields are refused. ' +
    'create: name; optional notes. ' +
    'update: id and at least one of name, transfer_acct, category (a default category, stored as a payee rule that may cover other payees; null deletes that whole rule). ' +
    'delete: id; DESTRUCTIVE, cannot be undone: transactions lose the payee; a transfer payee is refused. ' +
    'merge: target_id, merge_ids (1 to 50, never target_id itself); DESTRUCTIVE, cannot be undone: the sources\' transactions move to target_id and the sources are deleted; transfer payees are refused. ' +
    'set_note: id (a payee UUID), note ("" clears); not budget-YYYY-MM; an account note goes through manage_accounts and a category note through manage_categories. ' +
    'Returns { result: id } (create), { success, payeeId, updatedFields } (update), { success } (delete), { success, mergedIds, message } (merge), { result: { success, id, note, cleared } } (set_note).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_payees_create', fields: createFields }],
    ['update', { legacy: 'actual_payees_update', fields: updateFields, wrap: { into: 'fields', top: ['id'] } }],
    ['delete', { legacy: 'actual_payees_delete', fields: deleteFields }],
    ['merge', { legacy: 'actual_payees_merge', fields: mergeFields, rename: { target_id: 'targetId', merge_ids: 'mergeIds' } }],
    ['set_note', { legacy: 'actual_notes_update', fields: noteFields }],
  ]),
};
