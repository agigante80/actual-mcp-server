import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

/** Pinned by tests: the refusal for categoryId without overwrite. */
export const CATEGORY_NEEDS_OVERWRITE_MESSAGE = "categoryId always replaces that category's budgeted amount: pass overwrite: true to confirm.";

/**
 * EXPERIMENTAL (feature `budget_automations`, MCP_EXPERIMENTAL): published only when the operator
 * names the feature. WRITES budgeted amounts. Needs the budget's Goal templates setting on.
 */
export default createTool({
  name: 'actual_budgets_apply_templates',
  description:
    'Experimental (MCP_EXPERIMENTAL=budget_automations; may break on an Actual upgrade). WRITES budgeted amounts: applies the budget templates (the #template notes) to one month. ' +
    'Needs Settings > Experimental features > Goal templates on in this budget; if it is off the call is refused and nothing changes. Needs an envelope budget. ' +
    'Without overwrite, categories whose templates cannot be applied are skipped and the rest are filled. A template can also REDUCE a category: an "up to" limit lowers an amount above it, so review the changes. ' +
    'Money of a group source that has no sink goes to the global sink. ' +
    'overwrite true replaces the budgeted amount of every category the templates cover (a month-wide overwrite). ' +
    'categoryId applies the templates of that one category and always replaces its budgeted amount, so it requires overwrite true. ' +
    'Before writing it checks every template note: a month-wide apply is refused if ANY category note has an error, and a single-category apply is refused if an error entry starts with that category\'s name (a different category with the same name counts too). The refusal lists the entries; fix those notes in Actual and retry. ' +
    'Returns { month, verified, changes: [{ categoryId, name, before, after }] } from re-reading the month; changes is empty when nothing differed. verified false means the month was still changing when the wait ended: re-read it with actual_budgets_get_month. Never retry a call that errored without re-reading the month first.',
  schema: z.object({
    month: CommonSchemas.monthYear.describe('Budget month as YYYY-MM, one the budget has (actual_budgets_get_months lists them)'),
    categoryId: CommonSchemas.categoryId.optional().describe('Apply only this category (UUID from actual_categories_get). Requires overwrite true.'),
    overwrite: z.boolean().optional().describe('true replaces budgeted amounts; required with categoryId'),
  }).strict().superRefine((value, ctx) => {
    if (value.categoryId !== undefined && value.overwrite !== true) {
      ctx.addIssue({ code: 'custom', path: ['overwrite'], message: CATEGORY_NEEDS_OVERWRITE_MESSAGE });
    }
  }),
  handler: async ({ month, categoryId, overwrite }) => {
    return await adapter.applyBudgetTemplates(month, {
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(overwrite !== undefined ? { overwrite } : {}),
    });
  },
  examples: [
    { description: 'Apply the templates of a month, filling empty categories', input: { month: '2026-12' } },
    { description: 'Replace one category from its templates', input: { month: '2026-12', categoryId: '00000000-0000-4000-8000-000000000001', overwrite: true } },
  ],
});
