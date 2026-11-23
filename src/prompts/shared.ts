/**
 * Sentences shared by the prompt templates (#774). They are plain text with no placeholder and no
 * brace, so a template can splice them in before its own placeholders are filled.
 */

/** A read step that comes back empty: carry on with what exists, never widen the range alone. */
export const EMPTY_RESULT_LINE =
  'If a step returns no rows, say so plainly and carry on with what exists. Do not widen the date range on your own.';

/** The savings rate divides by income, which can be 0 for a period with no income. */
export const ZERO_INCOME_LINE =
  'If income is 0, say the savings rate cannot be computed instead of dividing by zero.';

/**
 * Where a defaulted argument came from. The default is read from the server clock (UTC in Docker,
 * the user's own zone under stdio), so the model is told to say so in its first line. The server
 * renders every range already: the clause never asks the model to redo date arithmetic.
 */
export const origin = {
  month: (m: string): string =>
    ` I did not name a month, so ${m} is the current month on the server clock, which can be in another time zone than mine. Say in your first line that the month came from the server clock, so I can run this again with the right one.`,
  date: (d: string): string =>
    ` I did not name a date, so ${d} is today on the server clock, which can be in another time zone than mine. Say in your first line that the date came from the server clock, so I can run this again with the right one.`,
  endMonth: (m: string): string =>
    ` I did not name an end month, so ${m} is the last full month before the current one on the server clock, which can be in another time zone than mine. Say in your first line that the end month came from the server clock, so I can run this again with the right one.`,
  unfinished:
    ' That month is not over: call every figure so far and do not present the savings rate as final.',
};
