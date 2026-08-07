import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * #333: expose `@actual-app/api`'s `getPreferences()`.
 *
 * These are the budget's SYNCED preferences (number format, date format,
 * currency, first day of week), which is exactly the context an assistant needs
 * to format amounts and dates the way the user's own budget does. Amounts stay
 * integer cents everywhere in this server; this tool tells a caller how the user
 * expects those cents to be RENDERED, it does not change any unit.
 *
 * Read-only. The upstream return type is `SyncedPrefs`, which our tsconfig maps
 * to the `@actual-app/core` stub (`any`), so there is no compile-time contract.
 * We therefore normalise defensively rather than trusting the shape.
 */
export default createTool({
  name: 'actual_preferences_get',
  description:
    'Read the budget\'s synced display preferences: number format, date format, currency, ' +
    'first day of the week, and similar settings. Use this to format amounts and dates the ' +
    'way this budget is configured to show them. Note these are DISPLAY preferences only: ' +
    'all amounts in this API remain integer cents (5000 = $50.00) regardless of what this returns.',
  schema: z.object({}),
  handler: async () => {
    const prefs = await adapter.getPreferences();

    // Upstream returns a plain synced-prefs object, but it is `any` to us and has
    // been observed to come back null when a budget has never had a preference
    // written. Normalise to an object so a caller can always read `.preferences`
    // without a null check, and report emptiness explicitly instead of silently.
    const preferences =
      prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? (prefs as Record<string, unknown>) : {};
    const keys = Object.keys(preferences);

    return {
      preferences,
      keys,
      count: keys.length,
      message:
        keys.length === 0
          ? 'This budget has no synced preferences set; Actual Budget is using its defaults.'
          : `Read ${keys.length} synced preference(s) for the active budget.`,
    };
  },
  examples: [{ description: 'Read the active budget display preferences', input: {} }],
});
