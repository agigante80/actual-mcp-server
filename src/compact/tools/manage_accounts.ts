import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { asFields, atLeastOne, issue, needs, strict } from '../refine.js';
import type { CompactActionRow, CompactRoute, CompactToolSpec } from '../types.js';

/**
 * manage_accounts (#676): the compact front for the nine account and account-group writers
 * plus bank sync and the account side of notes. Selector `action` is required. Nothing here
 * imports the adapter: the dispatcher reaches Actual only through callOperation (#671).
 *
 * Mapping (#670 section 7): create -> actual_accounts_create, or actual_account_groups_create
 * (entity account_group); update -> actual_accounts_update, or actual_account_groups_update;
 * close -> actual_accounts_close; reopen -> actual_accounts_reopen; delete ->
 * actual_accounts_delete, or actual_account_groups_delete; bank_sync -> actual_bank_sync;
 * set_note -> actual_notes_update (shared with the other manage_* tools, allowed in the
 * parity test only from the action set_note).
 *
 * WRITE tool: `nullAsAbsent` is NOT set. `entity` is consumed here and never forwarded.
 *
 * Every key several rows share is ONE light, optional schema object (the flat published schema
 * keeps a key typed only when all rows share the object, and the 3900 byte entry cap rules out
 * a UUID pattern per key). Required-ness and the strict formats live in the per-target refines.
 */

const entity = z.enum(['account', 'account_group']).optional().describe('account or account_group.');
const id = z.string().optional().describe('Account id (account group id with entity account_group).');
const name = z.string().optional().describe('Name, 1 to 255 characters.');
const balance = z.number().optional().describe('Opening balance, integer cents.');
const sortOrder = z.number().optional().describe('Sidebar position; lower first.');
const offbudget = z.boolean().optional().describe('Off-budget flag.');
const closed = z.boolean().optional().describe('Closed flag.');
const transferAccountId = z.string().optional().describe('Account that receives the remaining balance.');
const transferCategoryId = z.string().optional().describe('Category for the balancing transaction.');
const accountId = z.string().optional().describe('Account id; omit to sync every linked account.');
const note = z.string().optional().describe('Note text; "" clears it.');

const ACCOUNT_REAL: Readonly<Record<string, z.ZodType>> = {
  id: CommonSchemas.accountId,
  name: CommonSchemas.name,
  balance: CommonSchemas.amountCents,
  transfer_account_id: CommonSchemas.accountId,
  transfer_category_id: CommonSchemas.categoryId,
  account_id: CommonSchemas.accountId,
};
const GROUP_REAL: Readonly<Record<string, z.ZodType>> = { ...ACCOUNT_REAL, id: CommonSchemas.accountGroupId };

type V = Record<string, unknown>;

const createFields = asFields(
  z.object({ entity, name, balance }).superRefine((value, ctx) => {
    needs('create', ctx, value as V, ['entity', 'name']);
    strict(ctx, value as V, ACCOUNT_REAL);
  }),
);
const createGroupFields = asFields(
  z.object({ entity, name, sort_order: sortOrder }).superRefine((value, ctx) => {
    needs('create', ctx, value as V, ['entity', 'name']);
    strict(ctx, value as V, GROUP_REAL);
  }),
);
const updateFields = asFields(
  z.object({ entity, id, name, offbudget, closed }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, ACCOUNT_REAL);
    atLeastOne(ctx, value as V, ['name', 'offbudget', 'closed']);
  }),
);
const updateGroupFields = asFields(
  z.object({ entity, id, name, sort_order: sortOrder }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, GROUP_REAL);
    atLeastOne(ctx, value as V, ['name', 'sort_order']);
  }),
);
const closeFields = asFields(
  z.object({ entity, id, transfer_account_id: transferAccountId, transfer_category_id: transferCategoryId }).superRefine((value, ctx) => {
    const v = value as V;
    needs('close', ctx, v, ['id']);
    if (v.entity !== undefined && v.entity !== 'account') issue(ctx, 'entity', 'close accepts only account');
    strict(ctx, v, ACCOUNT_REAL);
    if (v.transfer_account_id !== undefined && v.transfer_account_id === v.id) {
      issue(ctx, 'transfer_account_id', 'must be a different account than id');
    }
  }),
);
const reopenFields = asFields(
  z.object({ id }).superRefine((value, ctx) => {
    needs('reopen', ctx, value as V, ['id']);
    strict(ctx, value as V, ACCOUNT_REAL);
  }),
);
const deleteFields = asFields(
  z.object({ entity, id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, ACCOUNT_REAL);
  }),
);
const deleteGroupFields = asFields(
  z.object({ entity, id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['entity', 'id']);
    strict(ctx, value as V, GROUP_REAL);
  }),
);
const bankSyncFields = asFields(
  z.object({ account_id: accountId }).superRefine((value, ctx) => strict(ctx, value as V, ACCOUNT_REAL)),
);
const noteFields = asFields(
  z.object({ id, note }).superRefine((value, ctx) => {
    needs('set_note', ctx, value as V, ['id', 'note']);
    strict(ctx, value as V, ACCOUNT_REAL);
  }),
);

const groupRoute = (legacy: string, fields: CompactActionRow['fields']): CompactRoute => ({
  triggers: ['entity'],
  when: (call) => call.entity === 'account_group',
  legacy,
  fields,
  drop: ['entity'],
});

export const manageAccounts: CompactToolSpec = {
  name: 'manage_accounts',
  domain: 'Changing data',
  summary: 'Create, change, close, reopen, delete, bank-sync or annotate accounts and account groups.',
  examplePrompt: 'Close my old savings account.',
  description:
    'Create, change, close, reopen, delete, bank-sync or annotate accounts and account groups; pick one `action`. Writes. ' +
    'To read or find ids use list_entities; month notes belong to manage_budget_months. Other fields are refused. ' +
    'entity (account or account_group) is required for create, update and delete; close takes account or nothing. ' +
    'create: entity, name; optional balance (account, integer cents, on-budget only) or sort_order (account_group). ' +
    'update: entity, id and at least one of name, offbudget, closed (account) or name, sort_order (account_group); to close or reopen prefer those actions. ' +
    'close: id; optional transfer_account_id (required for a non-zero balance, not id itself), transfer_category_id; an account with no transactions is REMOVED, not closed. ' +
    'reopen: id. ' +
    'delete: entity, id; DESTRUCTIVE, cannot be undone: an account takes its transactions with it (a closed one cannot be deleted), a group leaves its accounts ungrouped. ' +
    'bank_sync: optional account_id (omit for every linked open account); reaches the bank providers. ' +
    'set_note: id, note ("" clears); id is any entity UUID, not budget-YYYY-MM; for a category or payee note prefer manage_categories or manage_payees, so each note is set by the tool of its entity kind. ' +
    'Returns { result: id } (create account), { result: { id, name } } (create group), { success, accountId, updatedFields } (update account), ' +
    '{ result: { success, id, updated } } (update group), { success, closed | alreadyClosed | removed } (close), { success, reopened | alreadyOpen } (reopen), ' +
    '{ success } (delete account), { result: { success, id } } (delete group), { result, newTransactions, matchedTransactions, updatedAccounts, truncated } (bank_sync), ' +
    '{ result: { success, id, note, cleared } } (set_note).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_accounts_create', fields: createFields, drop: ['entity'], routes: [groupRoute('actual_account_groups_create', createGroupFields)] }],
    [
      'update',
      {
        legacy: 'actual_accounts_update',
        fields: updateFields,
        drop: ['entity'],
        wrap: { into: 'fields', top: ['id'] },
        routes: [groupRoute('actual_account_groups_update', updateGroupFields)],
      },
    ],
    ['close', { legacy: 'actual_accounts_close', fields: closeFields, drop: ['entity'], rename: { transfer_account_id: 'transferAccountId', transfer_category_id: 'transferCategoryId' } }],
    ['reopen', { legacy: 'actual_accounts_reopen', fields: reopenFields }],
    ['delete', { legacy: 'actual_accounts_delete', fields: deleteFields, drop: ['entity'], routes: [groupRoute('actual_account_groups_delete', deleteGroupFields)] }],
    ['bank_sync', { legacy: 'actual_bank_sync', fields: bankSyncFields, rename: { account_id: 'accountId' } }],
    ['set_note', { legacy: 'actual_notes_update', fields: noteFields }],
  ]),
};
