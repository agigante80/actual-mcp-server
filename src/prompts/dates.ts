/**
 * Date helpers shared by the prompts (#662). Every default is read from the server's LOCAL clock,
 * the same rule as legacy search_transactions by month (getFullYear, getMonth() + 1); in the
 * Docker image that is UTC. Month arithmetic is on integers only, never setMonth.
 */

import { z } from 'zod';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The shared `date` argument of the prompts that review a month as of a day (#662, #664): a real
 * YYYY-MM-DD calendar day, at most 10 characters, defaulting in the schema to the server's today.
 * CommonSchemas.date is not used: its pattern accepts 2026-02-31.
 */
const dayString = () =>
  z
    .string()
    .max(10)
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .refine(isCalendarDay, 'must be a real calendar date');

export const dayArgSchema = () => dayString().default(() => today());

/** The same checked day with no default: omitted stays undefined (#665, `since`). */
export const optionalDayArgSchema = () => dayString().optional();

/** The server's local current month, YYYY-MM. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** The server's local today, YYYY-MM-DD. */
export function today(): string {
  // One clock read: a second one could land in the next month across midnight on a month end.
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * The month before the server's local current month, YYYY-MM. getMonth() is 0 based, so it is
 * already the previous month's 1 based number; January rolls back to December of last year.
 * Never setMonth or getMonth() - 1 on a Date (on a 31st that overflows into the wrong month).
 */
export function previousMonth(): string {
  const now = new Date();
  const m = now.getMonth();
  return m === 0 ? `${now.getFullYear() - 1}-12` : `${now.getFullYear()}-${pad2(m)}`;
}

/**
 * The first day of the month that opens a span of `count` months ending with `endMonth`:
 * monthStart('2026-10', 6) is 2026-05-01, monthStart('2026-01', 3) is 2025-11-01. Integer month
 * index arithmetic only.
 */
export function monthStart(endMonth: string, count: number): string {
  const [y, m] = endMonth.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) - (count - 1);
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}-01`;
}

/** Days in a YYYY-MM month: 2024-02 gives 29, 2026-12 gives 31. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * True for a real YYYY-MM-DD calendar day (2024-02-29 yes, 2026-02-29 and 2026-02-31 no). Returns
 * false and never throws for any input, because Zod 4 runs a refine even after the regex failed.
 */
export function isCalendarDay(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
