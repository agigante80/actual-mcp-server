import { z } from 'zod';
import type { CompactActionRow } from './types.js';

/**
 * Row-level checks shared by the compact write tools that front several entity types (#676).
 * A flat published schema keeps a key typed only when every row shares ONE schema object, so a
 * shared key is declared once, light and optional. What a row really requires, and the strict
 * format of each value, is enforced here with messages in the compact tool's own key names,
 * before any legacy call. The legacy tool then validates again with its own unchanged schema.
 */

export const issue = (ctx: z.RefinementCtx, key: string, message: string): void => {
  ctx.addIssue({ code: 'custom', path: [key], message });
};

/** Refuse a missing key, in the same words the dispatcher uses for a required field. */
export const needs = (action: string, ctx: z.RefinementCtx, v: Record<string, unknown>, keys: readonly string[]): void => {
  for (const key of keys) if (v[key] === undefined) issue(ctx, key, `required for action: ${action}`);
};

/** Check each present, non-null value against its real schema and say which compact key was wrong. */
export const strict = (ctx: z.RefinementCtx, v: Record<string, unknown>, real: Readonly<Record<string, z.ZodType>>): void => {
  for (const [key, schema] of Object.entries(real)) {
    const value = v[key];
    if (value === undefined || value === null) continue;
    const r = schema.safeParse(value);
    if (!r.success) issue(ctx, key, r.error.issues[0]?.message ?? `invalid ${key}`);
  }
};

/** An update that names nothing to change is refused (some legacy updates were silent no-ops). */
export const atLeastOne = (ctx: z.RefinementCtx, v: Record<string, unknown>, changeable: readonly string[]): void => {
  if (!changeable.some((key) => v[key] !== undefined)) issue(ctx, 'id', `update needs at least one of: ${changeable.join(', ')}`);
};

/** A refined object is still a ZodObject at run time; the type loses that, so say it once. */
export const asFields = (schema: z.ZodType): CompactActionRow['fields'] => schema as unknown as CompactActionRow['fields'];

/**
 * Like `strict`, for a value with nested structure (an array of rule items): the message leads
 * with the path inside the value (`actions.0.op: ...`) so a caller learns WHICH element and key
 * to fix, not only that `actions` was wrong. The issue stays on the top-level compact key.
 */
export const strictDeep = (ctx: z.RefinementCtx, v: Record<string, unknown>, real: Readonly<Record<string, z.ZodType>>): void => {
  for (const [key, schema] of Object.entries(real)) {
    const value = v[key];
    if (value === undefined || value === null) continue;
    const r = schema.safeParse(value);
    if (r.success) continue;
    const first = r.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    const message = first?.code === 'unrecognized_keys' ? `unknown key ${first.keys.map((k) => `"${k}"`).join(', ')} at ${first.path.join('.') || key}` : (first?.message ?? `invalid ${key}`);
    issue(ctx, key, first?.code === 'unrecognized_keys' ? message : `${where}${message}`);
  }
};
