import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

/**
 * Apply the budget's goal templates for a month, as Actual's "Apply budget templates" menu item
 * does, or one category's template, as the category menu's "Apply budget template" does.
 * The adapter refuses when the budget's experimental goal templates feature is off.
 */
export default createTool({
  name: 'actual_budgets_apply_templates',
  description:
    'Run the category automations (UI-made or #template note lines) for one month (YYYY-MM), like ' +
    'Actual\'s "Apply budget templates": fills only categories with nothing budgeted that month. ' +
    'overwrite: true recomputes every templated category from scratch (its budget is pooled back first), like "Overwrite with budget templates"; use it to top up after each paycheck. ' +
    'With categoryId, always overwrites that category; omit overwrite or set it to true. ' +
    'Needs the goal templates feature on (Actual: Settings > Experimental features); otherwise an error says so. ' +
    'If a template that runs has an error, the call fails and sets no amounts. ' +
    'Returns { success, month, applied } where applied counts processed categories.',
  schema: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format').describe('Budget month in YYYY-MM format'),
    overwrite: z.boolean().optional().describe('Recompute every templated category, replacing its budget. Default false.'),
    categoryId: CommonSchemas.categoryId.optional().describe('Apply only this category\'s template (overwrites its budget).'),
  }).strict(),
  handler: async ({ month, categoryId, overwrite }) => {
    const res = await adapter.applyBudgetTemplates(month, categoryId, overwrite);
    if (res?.message === 'template-errors') {
      throw new Error(`No budget templates were applied for ${month}: fix these template errors in the category notes first.\n${res.pre ?? ''}`.trimEnd());
    }
    return { success: true as const, month, applied: res?.count ?? 0 };
  },
  examples: [
    { description: 'Apply every template for March 2026', input: { month: '2026-03' } },
  ],
});
