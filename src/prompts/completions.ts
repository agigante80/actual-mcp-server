/**
 * Argument completers for the prompts (#775). Pure: no logger, no I/O, no budget or session
 * access. Each takes the prefix the user has typed and returns the candidates that start with it,
 * in the order listed. Values come from the server clock only (UTC in the Docker image), the same
 * limit as the prompt defaults.
 */
import { currentMonth, monthStart, previousMonth, recentMonths, today } from './dates.js';

/** The protocol caps one completion result at 100 values. */
export const MAX_COMPLETION_VALUES = 100;

const startingWith = (candidates: string[], value: string): string[] =>
  candidates.filter((c) => c.startsWith(value));

/** The 12 months ending the current month, newest first (monthly_review.month). */
export function completeMonth(value: string): string[] {
  return startingWith(recentMonths(currentMonth(), 12), value);
}

/** The 12 months ending the PREVIOUS month, newest first (spending_patterns.end_month). */
export function completeEndMonth(value: string): string[] {
  return startingWith(recentMonths(previousMonth(), 12), value);
}

/** Today, the first of this month and the first of last month, without duplicates (date, since). */
export function completeDay(value: string): string[] {
  const candidates = [today(), monthStart(currentMonth(), 1), monthStart(previousMonth(), 1)];
  return startingWith([...new Set(candidates)], value);
}

/** Suggested month counts for spending_patterns.months (the schema accepts 1 to 24). */
export function completeMonthCount(value: string): string[] {
  return startingWith(['3', '6', '12', '24'], value);
}

/** The completion result: at most 100 values, the full count in total, hasMore when cut. */
export function capCompletions(values: string[]): { values: string[]; total: number; hasMore: boolean } {
  return {
    values: values.slice(0, MAX_COMPLETION_VALUES),
    total: values.length,
    hasMore: values.length > MAX_COMPLETION_VALUES,
  };
}
