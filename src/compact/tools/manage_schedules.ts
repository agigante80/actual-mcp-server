import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { RecurConfigSchema } from '../../lib/schemas/recur.js';
import { ScheduleAmountSchema, amountOpMismatch, ISBETWEEN_NEEDS_RANGE } from '../../lib/schemas/schedule-amount.js';
import { asFields, atLeastOne, issue, needs, strict } from '../refine.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * manage_schedules (#677): the compact front for the three schedule writers. Selector `action`
 * is required. Nothing here imports the adapter.
 *
 * Mapping (#670 section 7): create -> actual_schedules_create, update -> actual_schedules_update,
 * delete -> actual_schedules_delete. `amount_op` and `reset_next_date` are renamed to the legacy
 * camelCase; every other key passes through flat.
 *
 * WRITE tool: `nullAsAbsent` is NOT set (null clears payee and account on update). NO compact
 * schema carries a `.default()`: the legacy tool applies amountOp 'is' and posts_transaction
 * false on create and resetNextDate false on update itself, and a compact default on update
 * would silently stop an auto-posting schedule.
 *
 * `amount` and `date` are unions in the legacy schemas. The published schema must have no anyOf,
 * so they publish a multi-type `type` with a description and the real unions are enforced here,
 * before any legacy call, naming the compact key.
 */

const id = z.string().optional().describe('Schedule id.');
const name = z.string().optional().describe('Unique display name.');
const payee = z.string().nullable().optional().describe('Payee id; update: null clears.');
const account = z.string().nullable().optional().describe('Account id; update: null clears.');
const amount = z
  .any()
  .meta({ type: ['number', 'object'], description: 'Integer cents, outflow negative; with amount_op isbetween an object {num1, num2}.' });
const amountOp = z.enum(['is', 'isapprox', 'isbetween']).optional().describe('How to match the amount; default is on create.');
const date = z.any().meta({
  type: ['string', 'object'],
  description: 'One-off "YYYY-MM-DD", or a recurrence {frequency daily|weekly|monthly|yearly, start, endMode?, interval?, patterns?, skipWeekend?, weekendSolveMode?, endOccurrences?, endDate?}.',
});
const postsTransaction = z.boolean().optional().describe('Auto-post a transaction on each occurrence; default false on create.');
const resetNextDate = z.boolean().optional().describe('Recalculate next_date; set true when changing date.');

const DATE_SHAPE = 'date must be "YYYY-MM-DD" or a recurrence object {frequency, start, ...}';
// The legacy texts name `amountOp`; a compact caller sends `amount_op`.
const compactKeys = (text: string): string => text.replaceAll('amountOp', 'amount_op');

type V = Record<string, unknown>;

const REAL: Readonly<Record<string, z.ZodType>> = {
  id: CommonSchemas.scheduleId,
  payee: CommonSchemas.payeeId,
  account: CommonSchemas.accountId,
};

/** Check the amount and date unions with messages in compact names. */
const checkUnions = (ctx: z.RefinementCtx, v: V): void => {
  if (v.amount !== undefined && v.amount !== null) {
    const r = ScheduleAmountSchema.safeParse(v.amount);
    if (!r.success) issue(ctx, 'amount', compactKeys(r.error.issues[0]?.message ?? 'invalid amount'));
  }
  if (v.date !== undefined && v.date !== null) {
    if (typeof v.date === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) issue(ctx, 'date', DATE_SHAPE);
    } else if (typeof v.date === 'object' && !Array.isArray(v.date)) {
      const r = RecurConfigSchema.safeParse(v.date);
      if (!r.success) {
        const first = r.error.issues[0];
        issue(ctx, 'date', `${first?.path.length ? `${first.path.join('.')}: ` : ''}${first?.message ?? DATE_SHAPE}`);
      }
    } else issue(ctx, 'date', DATE_SHAPE);
  }
};

/** Only the listed keys may be null (update clears payee and account that way). */
const nullsOnly = (action: string, ctx: z.RefinementCtx, v: V, allowed: readonly string[]): void => {
  for (const [key, value] of Object.entries(v)) {
    if (value === null && !allowed.includes(key)) issue(ctx, key, `null is not valid for action: ${action}; omit the field instead`);
  }
};

const createFields = asFields(
  z.object({ name, payee, account, amount: amount.optional(), amount_op: amountOp, date: date.optional(), posts_transaction: postsTransaction }).superRefine((value, ctx) => {
    const v = value as V;
    needs('create', ctx, v, ['date']);
    nullsOnly('create', ctx, v, []);
    strict(ctx, v, REAL);
    checkUnions(ctx, v);
    // #527 cross-field rule, the same texts the legacy create refines with.
    const message = v.amount === undefined ? (v.amount_op === 'isbetween' ? ISBETWEEN_NEEDS_RANGE : null) : amountOpMismatch(v.amount_op, v.amount);
    if (message && !ctx.issues?.some((i) => i.path?.[0] === 'amount')) issue(ctx, 'amount', compactKeys(message));
  }),
);
const updateFields = asFields(
  z
    .object({ id, name, payee, account, amount: amount.optional(), amount_op: amountOp, date: date.optional(), posts_transaction: postsTransaction, reset_next_date: resetNextDate })
    .superRefine((value, ctx) => {
      const v = value as V;
      needs('update', ctx, v, ['id']);
      atLeastOne(ctx, v, ['name', 'payee', 'account', 'amount', 'amount_op', 'date', 'posts_transaction', 'reset_next_date']);
      nullsOnly('update', ctx, v, ['payee', 'account']);
      strict(ctx, v, REAL);
      checkUnions(ctx, v);
      if (v.amount !== undefined && v.amount_op !== undefined && !ctx.issues?.some((i) => i.path?.[0] === 'amount')) {
        const message = amountOpMismatch(v.amount_op, v.amount);
        if (message) issue(ctx, 'amount', compactKeys(message));
      }
    }),
);
const deleteFields = asFields(
  z.object({ id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['id']);
    strict(ctx, value as V, REAL);
  }),
);

export const manageSchedules: CompactToolSpec = {
  name: 'manage_schedules',
  description:
    'Create, change or delete schedules (one-off or recurring); pick one `action`. Writes. ' +
    'To read schedules use list_entities with type schedule; to preview occurrence dates use list_entities with type schedule and schedule_id. Cents are integers, outflows negative. Other fields are refused. ' +
    'create: date; optional name, payee, account, amount, amount_op, posts_transaction. amount_op isbetween needs amount {num1, num2}; an object amount needs isbetween. ' +
    'update: id and at least one of name, payee, account (null clears), amount, amount_op, date, posts_transaction, reset_next_date; unsent fields stay; a new date replaces the stored recurrence; completed and next_date cannot be set. ' +
    'delete: id; DESTRUCTIVE, cannot be undone; removes the schedule and the rule that drives it; transactions it already created stay; an unknown id is refused. ' +
    'Returns { id } (create), { success: true } (update, delete).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_schedules_create', fields: createFields, rename: { amount_op: 'amountOp' } }],
    ['update', { legacy: 'actual_schedules_update', fields: updateFields, rename: { amount_op: 'amountOp', reset_next_date: 'resetNextDate' } }],
    ['delete', { legacy: 'actual_schedules_delete', fields: deleteFields }],
  ]),
};
