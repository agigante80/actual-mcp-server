/**
 * Calendar date checks shared by the schemas and the prompts (#745).
 */

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
