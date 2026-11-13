import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * manage_transactions (#675): the compact front for the seven transaction writers.
 * Selector `action` is required. Nothing here imports the adapter: the dispatcher reaches
 * Actual only through callOperation (#671), so one compact call is one legacy call.
 *
 * Mapping (#670 section 7): create -> actual_transactions_create, update -> actual_transactions_update,
 * update_batch -> actual_transactions_update_batch, delete -> actual_transactions_delete,
 * import -> actual_transactions_import, merge -> actual_transactions_merge,
 * transfer -> actual_transfers_create.
 *
 * This is a WRITE tool, so `nullAsAbsent` is NOT set: null means "clear this field" in update.
 *
 * A key several actions share is ONE schema object (the flat published schema keeps a key typed
 * only when every row shares the very same object). That forces the shared schema to be the
 * loosest use: optional, and nullable where update needs null. The stricter per-action rules
 * (create/transfer require account, date, amount; only update accepts null; transfer amount is
 * positive) are enforced by a refine on the row's `fields`, with messages in compact names.
 * The legacy tool then validates again with its own unchanged schema.
 */

// The published schema is deliberately LIGHT (plain strings and numbers, short descriptions):
// the tool-size budget caps one tools/list entry at 3900 bytes, and a UUID pattern or a nested
// CommonSchemas object repeated per key would use it all. The strict rules are NOT lost: each row
// re-checks its values against the real CommonSchemas in the refine below (`REAL`), before any
// legacy call, with messages naming the compact key.
const id = z.string().describe('Transaction id.');
const account = z.string().nullable().optional().describe('Account id.');
const date = z.string().nullable().optional().describe('YYYY-MM-DD.');
const amount = z.number().nullable().optional().describe('Integer cents, outflow negative.');
const payee = z.string().nullable().optional().describe('Payee id (update: or name).');
const payeeName = z.string().nullable().optional().describe('Payee name.');
const importedPayee = z.string().nullable().optional().describe('Imported payee.');
const category = z.string().nullable().optional().describe('Category id.');
// No maxLength here: with it Zod publishes anyOf [string, null], which some function-schema
// clients reject. REAL enforces the 1000 character cap.
const notes = z.string().nullable().optional().describe('Notes.');
const cleared = z.boolean().nullable().optional().describe('Cleared flag.');
const importedId = z.string().nullable().optional().describe('Source id.');
const transferId = z.string().nullable().optional().describe('Transfer id.');
const reconciled = z.boolean().nullable().optional().describe('Reconciled flag.');
const subtransactions = z.array(z.looseObject({ amount: z.number() })).optional().describe('Split {amount, category?, notes?}; cents sum to amount.');

/** The real, strict per-key schemas the light published ones stand in for. */
const REAL: Readonly<Record<string, z.ZodType>> = {
  id: CommonSchemas.transactionId,
  account: CommonSchemas.accountId,
  account_id: CommonSchemas.accountId,
  from_account: CommonSchemas.accountId,
  to_account: CommonSchemas.accountId,
  category: CommonSchemas.categoryId,
  date: CommonSchemas.date,
  amount: CommonSchemas.amountCents,
  subtransactions: CommonSchemas.subtransactions,
  notes: z.string().max(1000, 'at most 1000 characters'),
};

/** The nine keys an update_batch item may change. Strict: an unknown key is refused. */
const BATCH_ITEM = z
  .object({
    id: CommonSchemas.transactionId,
    fields: z
      .object({
        account: CommonSchemas.accountId.nullable().optional(),
        date: CommonSchemas.date.nullable().optional(),
        amount: CommonSchemas.amountCents.nullable().optional(),
        payee: z.string().nullable().optional(),
        payee_name: z.string().nullable().optional(),
        imported_payee: z.string().nullable().optional(),
        category: CommonSchemas.categoryId.nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        cleared: z.boolean().nullable().optional(),
      })
      .strict(),
  })
  .strict();
const TX_ITEM = z.looseObject({ date: CommonSchemas.date, amount: CommonSchemas.amountCents });

const updates = z
  .array(z.looseObject({ id: z.string(), fields: z.looseObject({}) }))
  .min(1)
  .max(50)
  .superRefine((items, ctx) => {
    items.forEach((item, i) => {
      const r = BATCH_ITEM.safeParse(item);
      if (!r.success) ctx.addIssue({ code: 'custom', path: [i], message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
    });
  })
  .describe('1 to 50 {id, fields}; fields as update, minus imported_id, transfer_id, reconciled, subtransactions.');
const accountIdImport = z.string().describe('Account id.');
const txs = z
  .array(z.looseObject({ date: z.string(), amount: z.number() }))
  .min(1)
  .superRefine((items, ctx) => {
    items.forEach((item, i) => {
      const r = TX_ITEM.safeParse(item);
      if (!r.success) ctx.addIssue({ code: 'custom', path: [i], message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
    });
  })
  .describe('Rows {date, amount, imported_id?, payee_name?, category?, notes?}.');
const ids = z
  .array(z.string())
  .length(2)
  .superRefine((v, ctx) => {
    if (v.some((x) => !CommonSchemas.transactionId.safeParse(x).success)) ctx.addIssue({ code: 'custom', message: 'Invalid transaction ID format (expected UUID)' });
    else if (v[0] === v[1]) ctx.addIssue({ code: 'custom', message: 'ids must be two DIFFERENT transaction ids' });
  })
  .describe('Two transaction ids.');
const fromAccount = z.string().describe('Source account id.');
const toAccount = z.string().describe('Target account id.');

const issue = (ctx: z.RefinementCtx, key: string, message: string): void => {
  ctx.addIssue({ code: 'custom', path: [key], message });
};

/** Refuse a missing key, in the same words the dispatcher uses for a required field. */
const needs = (action: string, ctx: z.RefinementCtx, v: Record<string, unknown>, keys: readonly string[]): void => {
  for (const key of keys) if (v[key] === undefined) issue(ctx, key, `required for action: ${action}`);
};

/** Only update clears a field with null. */
const noNulls = (action: string, ctx: z.RefinementCtx, v: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(v)) if (value === null) issue(ctx, key, `null is only valid for action: update; ${action} omits the field instead`);
};

/** Check each present, non-null value against its real schema, and say which compact key was wrong. */
const strict = (ctx: z.RefinementCtx, v: Record<string, unknown>): void => {
  for (const [key, schema] of Object.entries(REAL)) {
    const value = v[key];
    if (value === undefined || value === null) continue;
    const r = schema.safeParse(value);
    if (!r.success) issue(ctx, key, r.error.issues[0]?.message ?? `invalid ${key}`);
  }
};

const asFields = (schema: z.ZodType): CompactActionRow['fields'] => schema as unknown as CompactActionRow['fields'];

const createFields = asFields(
  z
    .object({ account, date, amount, payee, payee_name: payeeName, notes, category, cleared, imported_id: importedId, subtransactions })
    .superRefine((value, ctx) => {
      const v = value as Record<string, unknown>;
      needs('create', ctx, v, ['account', 'date', 'amount']);
      noNulls('create', ctx, v);
      strict(ctx, v);
      if (typeof v.payee === 'string' && !CommonSchemas.payeeId.safeParse(v.payee).success) issue(ctx, 'payee', 'Invalid payee ID format (expected UUID)');
    }),
);

const updateFields = asFields(
  z
    .object({
      id,
      account,
      date,
      amount,
      payee,
      payee_name: payeeName,
      imported_payee: importedPayee,
      category,
      notes,
      imported_id: importedId,
      transfer_id: transferId,
      cleared,
      reconciled,
      subtransactions,
    })
    .superRefine((value, ctx) => {
      const v = value as Record<string, unknown>;
      strict(ctx, v);
      // The refine runs inside planCall's `.strict()`; the unit test proves it survives that.
      if (!Object.entries(v).some(([key, val]) => key !== 'id' && val !== undefined)) {
        issue(ctx, 'id', 'update needs at least one field to change besides id');
      }
    }),
);

const deleteFields = asFields(z.object({ id }).superRefine((value, ctx) => strict(ctx, value as Record<string, unknown>)));
const importFields = asFields(z.object({ account_id: accountIdImport, txs }).superRefine((value, ctx) => strict(ctx, value as Record<string, unknown>)));

const transferFields = asFields(
  z.object({ from_account: fromAccount, to_account: toAccount, amount, date, notes }).superRefine((value, ctx) => {
    const v = value as Record<string, unknown>;
    needs('transfer', ctx, v, ['amount', 'date']);
    noNulls('transfer', ctx, v);
    strict(ctx, v);
    if (typeof v.amount === 'number' && Number.isInteger(v.amount) && v.amount <= 0) {
      issue(ctx, 'amount', 'amount must be a positive integer in cents (e.g. 5000 = $50.00)');
    }
  }),
);

export const manageTransactions: CompactToolSpec = {
  name: 'manage_transactions',
  description:
    'Create, change, delete, import, merge or transfer transactions; pick one `action`. Writes. ' +
    'To read use search_transactions; ids come from list_entities. Cents are integers, outflows negative; dates YYYY-MM-DD. Other fields are refused. ' +
    'create: account, date, amount; optional payee, payee_name, notes, category, cleared, imported_id, subtransactions. ' +
    'update: id and at least one of account, date, amount, payee, payee_name, imported_payee, category, notes, imported_id, transfer_id, cleared, reconciled, subtransactions; null clears. ' +
    'update_batch: updates (1 to 50), NOT atomic, reported per item, no splits. ' +
    'delete: id; DESTRUCTIVE, permanent, balances change, cannot be undone. ' +
    'import: account_id, txs; matched like a bank import (rules applied; duplicates by imported_id or same amount within 7 days). ' +
    'merge: ids (two); DESTRUCTIVE, keeps one row by the upstream rule, deletes the other, cannot be undone. ' +
    'transfer: from_account, to_account, amount (positive), date; optional notes. ' +
    'Returns { success, id } (create; id often null, success false for an unknown account), { success } or { success, split } (update, delete), ' +
    '{ succeeded, failed, total, successCount, failureCount } (update_batch), { result: { added, updated, errors } } (import), ' +
    '{ result: { success, keptId, deletedId } } (merge), { result } (transfer; same or unknown account: result.success false).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_transactions_create', fields: createFields }],
    ['update', { legacy: 'actual_transactions_update', fields: updateFields, wrap: { into: 'fields', top: ['id'] } }],
    ['update_batch', { legacy: 'actual_transactions_update_batch', fields: z.object({ updates }) }],
    ['delete', { legacy: 'actual_transactions_delete', fields: deleteFields }],
    ['import', { legacy: 'actual_transactions_import', fields: importFields, rename: { account_id: 'accountId' } }],
    ['merge', { legacy: 'actual_transactions_merge', fields: z.object({ ids }) }],
    ['transfer', { legacy: 'actual_transfers_create', fields: transferFields }],
  ]),
};
