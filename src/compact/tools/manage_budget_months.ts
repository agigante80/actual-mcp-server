import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { MAX_BUDGET_AMOUNT_CENTS } from '../../lib/budget-limits.js';
import { asFields, issue, needs, strict, strictDeep } from '../refine.js';
import { FULL_SURFACE, type CompactActionRow, type CompactToolSpec, type DescriptionContext } from '../types.js';

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
const flag = z.boolean().optional().describe('true rolls an overspent balance into the next month, false resets it.');
const note = z.string().optional().describe('Note text for the month; "" clears it. Template directives such as "#template 250" work.');
const operations = z
  .array(z.object({ month: z.string(), categoryId: z.string(), amount: z.number().int().optional(), carryover: z.boolean().optional() }).strict())
  .optional()
  .describe('1 to 100 items {month, categoryId, amount?, carryover?} with camelCase keys; each needs amount or carryover.');

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format (month 01 to 12)');
const LIMIT_TEXT = `the limit Actual can store, ${MAX_BUDGET_AMOUNT_CENTS}`;
// #759: set_amount, transfer and the batch item are bounded to what upstream can store. The shared
// light `amount` schema stays unbounded because `hold` is clamped upstream and accepts any integer.
const CENTS = z
  .number()
  .int('amount must be an integer (cents)')
  .min(-MAX_BUDGET_AMOUNT_CENTS, `amount must be at least -${MAX_BUDGET_AMOUNT_CENTS} (${LIMIT_TEXT})`)
  .max(MAX_BUDGET_AMOUNT_CENTS, `amount must be at most ${MAX_BUDGET_AMOUNT_CENTS} (${LIMIT_TEXT})`);
const POSITIVE = CENTS.positive('amount must be greater than 0 (integer cents)');
const BATCH_ITEM = z
  .object({
    month: MONTH,
    categoryId: CommonSchemas.categoryId,
    amount: CommonSchemas.budgetAmountCents.optional(),
    carryover: z.boolean().optional(),
  })
  .strict()
  .refine((op) => op.amount !== undefined || op.carryover !== undefined, { message: 'each operation needs at least one of amount or carryover' });
const REAL_BATCH: Readonly<Record<string, z.ZodType>> = { operations: z.array(BATCH_ITEM).min(1).max(100) };

type V = Record<string, unknown>;

const HOLD_AMOUNT = z.number().int('amount must be an integer (cents)').positive('amount must be greater than 0 (integer cents)');
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
    strict(ctx, value as V, { ...monthRules, amount: HOLD_AMOUNT });
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

/** The published text covers only the actions and sibling tools this server carries (#770); the full surface is the default text. */
function describe(ctx: DescriptionContext): string {
  const a = (name: string) => ctx.hasAction(name);
  const only = (names: string[]) => names.filter(a);
  const nouns = [
    (a('set_amount') || a('set_amount_batch')) && 'amounts',
    a('set_carryover') && 'carryover',
    (a('hold') || a('reset_hold')) && 'the hold for next month',
    a('transfer') && 'transfers between categories',
    a('set_note') && 'the month note',
  ].filter((x): x is string => typeof x === 'string');
  const pointers = [
    ctx.hasTool('list_budget_months') && 'To read months use list_budget_months',
    ctx.hasTool('manage_budget_files') && 'to switch, import or export a budget file use manage_budget_files',
    ctx.hasTool('manage_categories') && 'category notes use manage_categories',
  ].filter((x): x is string => typeof x === 'string');
  const shapes = (names: string[], shape: string) => (only(names).length > 0 ? [`${shape} (${only(names).join(', ')})`] : []);
  const returns = [
    ...(a('set_amount') ? ['{} (set_amount)'] : []),
    ...(a('set_amount_batch') ? ['{ succeeded, failed, total, successCount, failureCount } (set_amount_batch; failing items are a normal result)'] : []),
    ...shapes(['set_carryover', 'reset_hold'], '{ success: true }'),
    ...(a('hold') ? ['{ success, held } or { success, partial, requested, held, message } (hold)'] : []),
    ...(a('transfer') ? ['{ result: { success, transferred, fromCategory, toCategory } } (transfer)'] : []),
    ...(a('set_note') ? ['{ result: { success, id, note, cleared } } (set_note)'] : []),
  ];
  return (
    `Change the budget of a month: ${nouns.join(', ')}; pick one \`action\`. Writes. ` +
    (pointers.length > 0 ? `${pointers.join('; ').replace(/^./, (c) => c.toUpperCase())}. ` : '') +
    (a('set_amount') ? 'set_amount: month, category_id, amount (the month must be one the budget has; an income category is refused on an envelope budget; |amount| at most 2251799813685247; an unknown category or month is returned as { success: false, error }). ' : '') +
    (a('set_amount_batch') ? 'set_amount_batch: operations, 1 to 100 items {month, categoryId, amount?, carryover?} with camelCase keys, each needing amount or carryover; NOT atomic, no rollback, items applied before a failure stay applied; an unknown category, a month out of range or carryover, or amount on an envelope budget, on an income category fails only that item; after a timeout read the months back before retrying. ' : '') +
    (a('set_carryover') ? 'set_carryover: month, category_id, flag (true rolls an overspent balance into the next month, false resets it; envelope budget: a positive balance always rolls over; tracking budget: only with the flag), from that month on; expense categories only. ' : '') +
    (a('hold') ? 'hold: month, amount greater than 0; holds for next month and may hold LESS than asked (clamped to what is left to budget); nothing held is an error; Actual ADDS to the buffer, so on an error read the month before retrying. ' : '') +
    (a('reset_hold') ? 'reset_hold: month; releases the whole hold back to to-budget. ' : '') +
    (a('transfer') ? 'transfer: month, from_category_id, to_category_id (different, expense categories only), amount greater than 0 and at most 2251799813685247; the source needs that much budgeted; NOT atomic, if the second write fails the source was already lowered. ' : '') +
    (a('set_note') ? 'set_note: month, note; sets or clears the month note. ' : '') +
    `Returns ${returns.join(', ')}.`
  );
}

export const manageBudgetMonths: CompactToolSpec = {
  name: 'manage_budget_months',
  domain: 'Budget months',
  summary: 'Set a month budget amount, carryover or hold, move money between categories and write the month note.',
  examplePrompt: 'Move $50 from Dining Out to Groceries for this month.',
  description: describe(FULL_SURFACE),
  describeFor: describe,
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
