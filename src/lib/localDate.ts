/**
 * Format a Date as YYYY-MM-DD from its LOCAL components.
 *
 * Do not use `date.toISOString().split('T')[0]` for a calendar day: that is the UTC day,
 * so local midnight on a host east of UTC renders as the previous day.
 */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
