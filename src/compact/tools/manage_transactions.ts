import { z } from 'zod';
import { CommonSchemas, TX_IMPORT_CHILD_KEYS, TX_IMPORT_ROW_KEYS, TX_UPDATE_NEEDS_A_FIELD, TX_UPDATE_NOT_NULL_KEYS, hasFieldToChange } from '../../lib/schemas/common.js';
import { FULL_SURFACE, type CompactActionRow, type CompactToolSpec, type DescriptionContext } from '../types.js';

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
const payee = z.string().nullable().optional().describe('Payee id.');
const payeeName = z.string().nullable().optional().describe('Payee name (matched, else created).');
const importedPayee = z.string().nullable().optional().describe('Imported payee.');
const category = z.string().nullable().optional().describe('Category id.');
// No maxLength here: with it Zod publishes anyOf [string, null], which some function-schema
// clients reject. capNotes enforces the 1000 character cap where the legacy tool has one.
const notes = z.string().nullable().optional().describe('Notes; "#word" tags it.');
const cleared = z.boolean().nullable().optional().describe('Cleared flag.');
const importedId = z.string().nullable().optional().describe('Source id.');
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
};

/** The nine keys an update_batch item may change. Strict: an unknown key is refused. */
const BATCH_ITEM = z
  .object({
    id: CommonSchemas.transactionId,
    fields: z
      .object({
        account: CommonSchemas.accountId.optional(),
        date: CommonSchemas.date.optional(),
        amount: CommonSchemas.amountCents.optional(),
        payee: z.string().nullable().optional(),
        payee_name: z.string().nullable().optional(),
        imported_payee: z.string().nullable().optional(),
        category: CommonSchemas.categoryId.nullable().optional(),
        notes: z.string().nullable().optional(),
        cleared: z.boolean().nullable().optional(),
      })
      .strict()
      .refine((v) => hasFieldToChange(v, ''), { message: TX_UPDATE_NEEDS_A_FIELD }),
  })
  .strict();
const TX_ITEM = z.looseObject({ date: CommonSchemas.date, amount: CommonSchemas.amountCents });
const TX_ROW_KEYS: ReadonlySet<string> = new Set(TX_IMPORT_ROW_KEYS);
const TX_CHILD_KEYS: ReadonlySet<string> = new Set(TX_IMPORT_CHILD_KEYS);

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
  .describe('1 to 50 {id, fields}; fields as update, minus imported_id, reconciled, subtransactions.');
const accountIdImport = z.string().describe('Account id.');
const txs = z
  .array(z.looseObject({ date: z.string(), amount: z.number() }))
  .min(1)
  .superRefine((items, ctx) => {
    items.forEach((item, i) => {
      const r = TX_ITEM.safeParse(item);
      if (!r.success) ctx.addIssue({ code: 'custom', path: [i], message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      // #749: an unknown key would reach the database layer, which throws "Field does not exist" with the row JSON.
      const unknown = Object.keys(item).filter((key) => !TX_ROW_KEYS.has(key));
      if (unknown.length > 0) {
        const named = unknown.map((key) => `"${key}"`).join(', ');
        ctx.addIssue({ code: 'custom', path: [i], message: `Unrecognized key${unknown.length > 1 ? 's' : ''}: ${named}` });
      }
      // #749: the same for a split child, which upstream spreads into the row.
      const children = (item as { subtransactions?: unknown }).subtransactions;
      if (Array.isArray(children)) {
        children.forEach((child, j) => {
          if (child === null || typeof child !== 'object') return;
          const childAmount = (child as { amount?: unknown }).amount;
          if (typeof childAmount === 'number' && !Number.isInteger(childAmount)) {
            ctx.addIssue({ code: 'custom', path: [i, 'subtransactions', j, 'amount'], message: 'Amount must be an integer (cents)' });
          }
          const bad = Object.keys(child).filter((key) => !TX_CHILD_KEYS.has(key));
          if (bad.length === 0) return;
          const named = bad.map((key) => `"${key}"`).join(', ');
          ctx.addIssue({ code: 'custom', path: [i, 'subtransactions', j], message: `Unrecognized key${bad.length > 1 ? 's' : ''}: ${named}` });
        });
      }
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

/**
 * The legacy create and transfer tools cap notes at 1000 characters; the legacy update and
 * update_batch tools do not, so the cap is applied only where the legacy tool would refuse.
 */
const capNotes = (ctx: z.RefinementCtx, v: Record<string, unknown>): void => {
  if (typeof v.notes === 'string' && v.notes.length > 1000) issue(ctx, 'notes', 'at most 1000 characters');
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
      capNotes(ctx, v);
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
      cleared,
      reconciled,
      subtransactions,
    })
    .superRefine((value, ctx) => {
      const v = value as Record<string, unknown>;
      strict(ctx, v);
      // #814: account, date and amount are NOT NULL upstream. The flat key is shared with create
      // (so it stays nullable in the published schema); update refuses null here, by name.
      for (const key of TX_UPDATE_NOT_NULL_KEYS) {
        if (v[key] === null) issue(ctx, key, 'cannot be null; omit it to leave it unchanged');
      }
      // The refine runs inside planCall's `.strict()`; the unit test proves it survives that.
      if (!hasFieldToChange(v)) issue(ctx, 'id', TX_UPDATE_NEEDS_A_FIELD);
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
    capNotes(ctx, v);
    if (typeof v.amount === 'number' && Number.isInteger(v.amount) && v.amount <= 0) {
      issue(ctx, 'amount', 'amount must be a positive integer in cents (e.g. 5000 = $50.00)');
    }
  }),
);

/** The published text covers only the actions and sibling tools this server carries (#770); the full surface is the default text. */
function describe(ctx: DescriptionContext): string {
  const a = (name: string) => ctx.hasAction(name);
  const verbs = [
    a('create') && 'create',
    (a('update') || a('update_batch')) && 'change',
    a('delete') && 'delete',
    a('import') && 'import',
    a('merge') && 'merge',
    a('transfer') && 'transfer',
  ].filter((x): x is string => typeof x === 'string');
  const pointers = [
    ctx.hasTool('search_transactions') && 'To read use search_transactions',
    ctx.hasTool('list_entities') && 'ids come from list_entities',
  ].filter((x): x is string => typeof x === 'string');
  const updateDelete = ['update', 'delete'].filter(a);
  const returns = [
    ...(a('create') ? ['{ success, id } (create; id often null, success false when an id is unknown or a payee is a transfer payee)'] : []),
    ...(updateDelete.length > 0 ? [`{ success } or { success, split } (${updateDelete.join(', ')})`] : []),
    ...(a('update_batch') ? ['{ succeeded, failed, total, successCount, failureCount } (update_batch)'] : []),
    ...(a('import') ? ['{ result: { added, updated, errors } } (import)'] : []),
    ...(a('merge') ? ['{ result: { success, keptId, deletedId } } (merge)'] : []),
    ...(a('transfer') ? ['{ result } (transfer; same or unknown account: result.success false)'] : []),
  ];
  const lead = verbs.length > 1 ? `${verbs.slice(0, -1).join(', ')} or ${verbs[verbs.length - 1]}` : verbs.join('');
  return (
    `${lead.charAt(0).toUpperCase()}${lead.slice(1)} transactions; pick one \`action\`. Writes. ` +
    (pointers.length > 0 ? `${pointers.join('; ').replace(/^./, (c) => c.toUpperCase())}. ` : '') +
    'Cents are integers, outflows negative; dates YYYY-MM-DD. Other fields are refused. ' +
    (a('create') ? 'create: account, date, amount; optional payee, payee_name, notes, category, cleared, imported_id, subtransactions. ' : '') +
    (a('update') ? 'update: id and at least one of account, date, amount, payee, payee_name, imported_payee, category, notes, imported_id, cleared, reconciled, subtransactions; null clears payee, category or notes. ' : '') +
    (a('update_batch') ? 'update_batch: updates (1 to 50), NOT atomic, reported per item, no splits. ' : '') +
    (a('delete') ? 'delete: id; DESTRUCTIVE, permanent, balances change, cannot be undone. ' : '') +
    (a('import') ? 'import: account_id, txs; matched like a bank import (rules applied; duplicates by imported_id or same amount within 7 days). ' : '') +
    (a('merge') ? 'merge: ids (two); DESTRUCTIVE, keeps one row by the upstream rule, deletes the other, cannot be undone. ' : '') +
    (a('transfer') ? 'transfer: from_account, to_account, amount (positive), date; optional notes. ' : '') +
    `Returns ${returns.join(', ')}.`
  );
}

export const manageTransactions: CompactToolSpec = {
  name: 'manage_transactions',
  domain: 'Changing data',
  summary: 'Create, change, delete, import, merge or transfer transactions.',
  examplePrompt: 'Add a $12.50 coffee purchase to my checking account for today.',
  description: describe(FULL_SURFACE),
  describeFor: describe,
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
