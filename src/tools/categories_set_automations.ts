import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { AUTOMATION_TYPES, EDITOR_AUTOMATIONS } from '../lib/schemas/automations.js';
import adapter from '../lib/actual-adapter.js';

/**
 * The published schema is deliberately LIGHT (each entry names its type and passes the rest
 * through) to stay under the per-tool byte ceiling. The strict per-type schema runs in the
 * superRefine below, and the adapter parses again so a direct call cannot skip it.
 */
export const LIGHT_AUTOMATION = z.object({ type: z.enum(AUTOMATION_TYPES).describe('Automation type') }).passthrough();

/** Re-add the strict list's issues under `automations`, so a caller sees the entry that failed. */
export function checkAutomations(list: unknown, ctx: z.RefinementCtx): void {
  const strict = EDITOR_AUTOMATIONS.safeParse(list);
  if (strict.success) return;
  for (const issue of strict.error.issues) {
    ctx.addIssue({ code: 'custom', path: ['automations', ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))], message: issue.message });
  }
}

/**
 * EXPERIMENTAL (feature `budget_automations`, MCP_EXPERIMENTAL): published only when the operator
 * names the feature. WRITES one category's automations (always the editor form, source "ui").
 */
export default createTool({
  name: 'actual_categories_set_automations',
  description:
    'Experimental (MCP_EXPERIMENTAL=budget_automations; may break on an Actual upgrade). WRITES one category\'s budget automations in the editor form (source "ui"); the list REPLACES what is stored. ' +
    'Needs Settings > Experimental features > Goal templates AND the automations editor on in this budget; if either is off the call is refused and nothing changes. ' +
    'Entries use the shape actual_categories_get_automations returns, so a read result can be edited and sent back. Entry types: periodic, limit, refill, percentage, average, by, remainder, goal, schedule. ' +
    'Money is integer minor units of the budget currency. A schedule entry names a schedule by scheduleId or name; Actual matches it by NAME, so renaming that schedule later breaks the entry. ' +
    'A category whose automations are #template, #goal or #cleanup note lines is refused unless confirmNoteSwitch is true: saving switches it to the editor and those lines stop being read (the note text is kept). Cleanup is never changed. ' +
    'Refused before writing: more than one limit or goal, refill without a limit, a weekly limit without start, percentages of one source over 100, schedule and by entries with different priorities, an unknown or unnamed schedule, a percentage source that is not an income category. ' +
    'Returns the saved automations as actual_categories_get_automations does, plus verified (false: the stored value was not seen to match; re-read it before retrying).',
  schema: z.object({
    categoryId: CommonSchemas.categoryId.describe('Category UUID, from actual_categories_get'),
    automations: z.array(LIGHT_AUTOMATION).max(50).describe('The full list of automations for the category (replaces the stored list)'),
    confirmNoteSwitch: z.boolean().optional().describe('true confirms switching a note-managed category to the editor'),
  }).strict().superRefine((value, ctx) => checkAutomations(value.automations, ctx)),
  handler: async ({ categoryId, automations, confirmNoteSwitch }) => {
    return await adapter.setCategoryAutomations({
      categoryId,
      automations,
      ...(confirmNoteSwitch !== undefined ? { confirmNoteSwitch } : {}),
    });
  },
  examples: [
    {
      description: 'Budget 50.00 a month with a 200.00 cap',
      input: {
        categoryId: '00000000-0000-4000-8000-000000000001',
        automations: [
          { type: 'periodic', amount: 5000, period: { period: 'month', amount: 1 }, starting: '2026-12-01', priority: 1 },
          { type: 'limit', amount: 20000, period: 'monthly' },
        ],
      },
    },
  ],
});
