import { z } from 'zod';

// #527: a schedule's amount is a plain number for amountOp 'is' and 'isapprox', and a
// { num1, num2 } range for 'isbetween'. That is upstream's own rule (`number.parse` in
// @actual-app/api 26.10.0): its matcher reads value.num1 and value.num2, so a scalar
// 'isbetween' is stored but can never match a transaction. createSchedule and
// updateSchedule do no validation of their own, so every refusal here is ours.
//
// The create refinement, the update refinement and the adapter's read-then-write guard all
// call amountOpMismatch, so the three cannot drift apart in what they refuse or how they say it.

export const AmountRangeSchema = z.object({
  num1: z.number().int().describe('Range bound, integer cents (negative is an outflow)'),
  num2: z.number().int().describe('Other range bound, integer cents'),
}).strict();

// A bare union failure reads "Invalid input", which tells a caller nothing; the custom
// error names both accepted shapes, and the central formatter passes it through with its path.
export const AMOUNT_SHAPE =
  "amount must be integer cents (for example -5000), or { num1, num2 } as two integers with amountOp 'isbetween'";

export const ScheduleAmountSchema = z.union([z.number().int(), AmountRangeSchema], { error: AMOUNT_SHAPE });

export const ISBETWEEN_NEEDS_RANGE =
  "amountOp 'isbetween' needs amount as { num1, num2 } in cents, for example { num1: -10000, num2: -5000 }. " +
  "To match a single amount, send amountOp 'is' or 'isapprox' with a number instead.";

export const RANGE_NEEDS_ISBETWEEN =
  "an amount given as { num1, num2 } needs amountOp: 'isbetween'. For a single amount, send a number.";

function isRange(amount: unknown): boolean {
  if (typeof amount !== 'object' || amount === null) return false;
  const { num1, num2 } = amount as { num1?: unknown; num2?: unknown };
  return typeof num1 === 'number' && typeof num2 === 'number';
}

/**
 * Returns the refusal message when the op and the amount do not fit together, else null.
 * A missing op counts as 'is' (create defaults it, and upstream keeps a stored null op on a
 * partial update). An amount that is neither a number nor a range (absent, or a stored value
 * of an unexpected shape) is not judged here: returning null keeps the guard from refusing
 * an update it cannot decode.
 */
export function amountOpMismatch(op: unknown, amount: unknown): string | null {
  const effectiveOp = op ?? 'is';
  if (typeof amount === 'number') return effectiveOp === 'isbetween' ? ISBETWEEN_NEEDS_RANGE : null;
  if (isRange(amount)) return effectiveOp === 'isbetween' ? null : RANGE_NEEDS_ISBETWEEN;
  return null;
}
