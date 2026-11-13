import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { asFields, issue, needs, strict, strictDeep } from '../refine.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * manage_budget_months (#678): the compact front for the six budget month writers and the budget
 * month use of notes_update. Selector `action` is required. Nothing here imports the adapter.
 *
 * Mapping (#670 section 7): set_amount -> actual_budgets_set_amount, set_amount_batch ->
 * actual_budget_updates_batch, set_carryover -> actual_budgets_set_carryover, hold ->
 * actual_budgets_hold_for_next_month, reset_hold -> actual_budgets_reset_hold, transfer ->
 * actual_budgets_transfer, set_note -> actual_notes_update (shared, allowed in the parity test
 * only from set_note) with the id built by the `build` hook as `budget-<month>`.
 *
 * WRITE tool: `nullAsAbsent` is NOT set and no schema carries a `.default()`.
 *
 * Shared keys (month, category_id, amount) are ONE light optional schema object each, so the
 * published schema keeps their type and description. The real rules (month shape, UUID ids,
 * integer cents, amount greater than 0 for hold and transfer, the batch item schema) run in the
 * per-action refines before any legacy call, with messages naming the compact key. The legacy
 * tool validates again with its own unchanged schema.
 */

const month = z.string().optional().describe('Budget month as YYYY-MM, one the budget has (list_budget_months lists them).');
const categoryId = z.string().optional().describe('Category id.');
const fromCategoryId = z.string().optional().describe('Source category id.');
const toCategoryId = z.string().optional().describe('Target category id, different from from_category_id.');
const amount = z.number().int().optional().describe('Integer cents (5000 is $50.00). set_amount: the new budgeted amount; hold and transfer: greater than 0.');
const flag = z.boolean().optional().describe('true carries the category balance into next month, false does not.');
const note = z.string().optional().describe('Note text for the month; "" clears it. Template directives such as "#template 250" work.');
const operations = z
  .array(z.object({ month: z.string(), categoryId: z.string(), amount: z.number().int().optional(), carryover: z.boolean().optional() }).strict())
  .optional()
  .describe('1 to 100 items {month, categoryId, amount?, carryover?} with camelCase keys; each needs amount or carryover.');

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format (month 01 to 12)');
const CENTS = z.number().int('amount must be an integer (cents)');
const POSITIVE = CENTS.positive('amount must be greater than 0 (integer cents)');
const BATCH_ITEM = z
  .object({
    month: MONTH,
    categoryId: CommonSchemas.categoryId,
    amount: CommonSchemas.amountCents.optional(),
    carryover: z.boolean().optional(),
  })
  .strict()
  .refine((op) => op.amount !== undefined || op.carryover !== undefined, { message: 'each operation needs at least one of amount or carryover' });
const REAL_BATCH: Readonly<Record<string, z.ZodType>> = { operations: z.array(BATCH_ITEM).min(1).max(100) };

type V = Record<string, unknown>;

const monthRules = { month: MONTH };
const setAmountFields = asFields(
  z.object({ month, category_id: categoryId, amount }).superRefine((value, ctx) => {
    needs('set_amount', ctx, value as V, ['month', 'category_id', 'amount']);
    strict(ctx, value as V, { ...monthRules, category_id: CommonSchemas.categoryId, amount: CENTS });
  }),
);
const batchFields = asFields(
  z.object({ operations }).superRefine((value, ctx) => {
    needs('set_amount_batch', ctx, value as V, ['operations']);
    strictDeep(ctx, value as V, REAL_BATCH);
  }),
);
const carryoverFields = asFields(
  z.object({ month, category_id: categoryId, flag }).superRefine((value, ctx) => {
    needs('set_carryover', ctx, value as V, ['month', 'category_id', 'flag']);
    strict(ctx, value as V, { ...monthRules, category_id: CommonSchemas.categoryId });
  }),
);
const holdFields = asFields(
  z.object({ month, amount }).superRefine((value, ctx) => {
    needs('hold', ctx, value as V, ['month', 'amount']);
    strict(ctx, value as V, { ...monthRules, amount: POSITIVE });
  }),
);
const resetHoldFields = asFields(
  z.object({ month }).superRefine((value, ctx) => {
    needs('reset_hold', ctx, value as V, ['month']);
    strict(ctx, value as V, monthRules);
  }),
);
const transferFields = asFields(
  z.object({ month, from_category_id: fromCategoryId, to_category_id: toCategoryId, amount }).superRefine((value, ctx) => {
    const v = value as V;
    needs('transfer', ctx, v, ['month', 'from_category_id', 'to_category_id', 'amount']);
    strict(ctx, v, { ...monthRules, from_category_id: CommonSchemas.categoryId, to_category_id: CommonSchemas.categoryId, amount: POSITIVE });
    if (v.from_category_id !== undefined && v.from_category_id === v.to_category_id) issue(ctx, 'to_category_id', 'must differ from from_category_id');
  }),
);
const noteFields = asFields(
  z.object({ month, note }).superRefine((value, ctx) => {
    needs('set_note', ctx, value as V, ['month', 'note']);
    // The adapter skips its entity lookup for "budget-YYYY-MM", so a month like 2026-13 would write an orphan note.
    strict(ctx, value as V, monthRules);
  }),
);

export const manageBudgetMonths: CompactToolSpec = {
  name: 'manage_budget_months',
  description:
    'Change the budget of a month: amounts, carryover, the hold for next month, transfers between categories, the month note; pick one `action`. Writes. ' +
    'To read months use list_budget_months; to switch, import or export a budget file use manage_budget_files; category notes use manage_categories. Cents are integers. Other fields are refused. ' +
    'set_amount: month, category_id, amount (the month must be one the budget has; an unknown category or month is returned as { success: false, error }). ' +
    'set_amount_batch: operations, 1 to 100 items {month, categoryId, amount?, carryover?} with camelCase keys, each needing amount or carryover; NOT atomic, no rollback, items applied before a failure stay applied; an unknown category, a month out of range or carryover on an income category fails only that item; the last item wins for the same month and category; after a timeout read the months back before retrying. ' +
    'set_carryover: month, category_id, flag. ' +
    'hold: month, amount greater than 0; holds for next month and may hold LESS than asked (clamped to what is left to budget); nothing held is an error; Actual ADDS to the buffer, so on an error read the month before retrying. ' +
    'reset_hold: month; releases the whole hold back to to-budget, safe to repeat. ' +
    'transfer: month, from_category_id, to_category_id (different), amount greater than 0; the source needs that much budgeted; NOT atomic, if the second write fails the source was already lowered. ' +
    'set_note: month, note; sets or clears the note of that budget month. ' +
    'Returns { result } (set_amount), { succeeded, failed, total, successCount, failureCount } (set_amount_batch; failing items are a normal result), { success: true } (set_carryover, reset_hold), { success, held } or { success, partial, requested, held, message } (hold), { result: { success, transferred, fromCategory, toCategory } } (transfer), { result: { success, id, note, cleared } } (set_note).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['set_amount', { legacy: 'actual_budgets_set_amount', fields: setAmountFields, rename: { category_id: 'categoryId' } }],
    ['set_amount_batch', { legacy: 'actual_budget_updates_batch', fields: batchFields }],
    ['set_carryover', { legacy: 'actual_budgets_set_carryover', fields: carryoverFields, rename: { category_id: 'categoryId' } }],
    ['hold', { legacy: 'actual_budgets_hold_for_next_month', fields: holdFields }],
    ['reset_hold', { legacy: 'actual_budgets_reset_hold', fields: resetHoldFields }],
    ['transfer', { legacy: 'actual_budgets_transfer', fields: transferFields, rename: { from_category_id: 'fromCategoryId', to_category_id: 'toCategoryId' } }],
    ['set_note', { legacy: 'actual_notes_update', fields: noteFields, build: (a) => ({ id: `budget-${String(a.month)}`, note: a.note }) }],
  ]),
};
