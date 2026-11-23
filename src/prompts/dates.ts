/**
 * Date helpers shared by the prompts (#662). Every default is read from the server's LOCAL clock,
 * the same rule as legacy search_transactions by month (getFullYear, getMonth() + 1); in the
 * Docker image that is UTC. Month arithmetic is on integers only, never setMonth.
 */

import { z } from 'zod';
import { isCalendarDay } from '../lib/dates.js';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The shared `date` argument of the prompts that review a month as of a day (#662, #664): a real
 * YYYY-MM-DD calendar day, at most 10 characters, defaulting in the schema to the server's today.
 * CommonSchemas.date is not used here: the prompts keep their own stricter regex (month 01 to 12,
 * day 01 to 31) and the 10 character cap (#745).
 */
const DAY_MESSAGE = 'must be YYYY-MM-DD, a real calendar day';
const MONTH_MESSAGE = 'must be YYYY-MM';

// Every check before the last carries `abort: true` (#772): Zod 4 otherwise runs the later checks
// after a failed one and the caller reads two messages for one fault. The messages are static text,
// never built from the input, so a refusal stays value-free.
const dayString = () =>
  z
    .string()
    .max(10, { error: DAY_MESSAGE, abort: true })
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { error: DAY_MESSAGE, abort: true })
    .refine(isCalendarDay, DAY_MESSAGE);

/** The shared `YYYY-MM` argument (month 01 to 12, at most 7 characters), one readable message (#772). */
export const monthArgSchema = () =>
  z
    .string()
    .max(7, { error: MONTH_MESSAGE, abort: true })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, MONTH_MESSAGE);

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
 * `count` months ending with `endMonth`, newest first: recentMonths("2026-01", 3) is
 * ['2026-01', '2025-12', '2025-11']. Integer month index arithmetic only (#775).
 */
export function recentMonths(endMonth: string, count: number): string[] {
  const [y, m] = endMonth.split('-').map(Number) as [number, number];
  const end = y * 12 + (m - 1);
  return Array.from({ length: count }, (_, i) => {
    const idx = end - i;
    return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
  });
}
