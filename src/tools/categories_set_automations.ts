import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { AutomationSchema, CleanupSchema, toCleanupRows, toTemplate } from '../lib/schemas/automations.js';

/**
 * Add (or with replace, set) a category's budget automations as Actual's automation editor saves
 * them, importing note templates first. Omitted fields take the editor defaults; see src/lib/schemas/automations.ts.
 */
export default createTool({
  name: 'actual_categories_set_automations',
  description:
    "Add budget automations to a category as Actual's automation editor does, keeping what it has (#template note lines are imported first, " +
    "then the note is ignored). replace: true drops them; replace with [] clears. Not idempotent. Uses editor defaults (priority 1), " +
    "validates the merged list. Cents. cleanup: #cleanup lines, run by actual_budgets_run_cleanup. " +
    "Needs Settings > Experimental features > Goal templates, Budget automations UI. " +
    "Returns { success, categoryId, imported, count, cleanup? }.",
  schema: z.object({
    categoryId: CommonSchemas.categoryId,
    automations: z.array(AutomationSchema).max(20).optional().describe('0 to 20 to add after the existing ones.'),
    replace: z.boolean().optional().describe('Drop existing ones first.'),
    cleanup: CleanupSchema.optional(),
  }).strict().refine((v) => v.automations !== undefined || v.cleanup !== undefined, { message: 'give automations, cleanup or both', path: ['automations'] }),
  handler: async ({ categoryId, automations, replace, cleanup }) => {
    const res = await adapter.setCategoryAutomations(categoryId, (automations ?? []).map((a) => toTemplate(a)), replace, cleanup && toCleanupRows(cleanup));
    return { success: true as const, categoryId, ...res };
  },
  examples: [
    { description: 'Budget $250 a month at priority 2', input: { categoryId: '10000000-0000-4000-8000-000000000001', automations: [{ type: 'fixed', amount: 25000, priority: 2 }] } },
  ],
});
