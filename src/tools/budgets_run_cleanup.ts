import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * Run Actual's "End of month cleanup" for a month. The adapter refuses when goal templates are
 * off or the budget uses tracking budgeting.
 */
export default createTool({
  name: 'actual_budgets_run_cleanup',
  description:
    'Run Actual\'s "End of month cleanup" for one month (YYYY-MM), envelope budgets only: categories set to send return their leftover, ' +
    'EVERY overspent expense category without carryover is covered from To Budget as far as it goes, then receivers share what is left by weight; ' +
    'named pools move money only among their members. Set a category\'s cleanup with actual_categories_set_automations. Changes budget amounts; ' +
    'Read the month before retrying: up-to-date and no-funds can still change amounts. Needs Goal templates on. ' +
    'Returns { success, month, outcome, sources, sinks, warnings }; outcome is cleanup-applied, cleanup-up-to-date or cleanup-no-funds.',
  schema: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').describe('Budget month in YYYY-MM format'),
  }).strict(),
  handler: async ({ month }) => {
    const res = await adapter.runBudgetCleanup(month);
    return {
      success: true as const,
      month,
      outcome: res?.message ?? 'cleanup-applied',
      sources: res?.sourceCount ?? null,
      sinks: res?.sinkCount ?? null,
      warnings: res?.pre ? res.pre.split('\n\n') : [],
    };
  },
  examples: [{ description: 'Clean up October 2026', input: { month: '2026-10' } }],
});
