import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

/**
 * EXPERIMENTAL (feature `budget_automations`, MCP_EXPERIMENTAL): published only when the operator
 * names the feature. MOVES money between categories. Needs the budget's Goal templates setting on.
 */
export default createTool({
  name: 'actual_budgets_run_cleanup',
  description:
    'Experimental (MCP_EXPERIMENTAL=budget_automations; may break on an Actual upgrade). WRITES budgeted amounts: runs end of month cleanup for one month, moving money from the source categories to the sink categories set in the cleanup automations. ' +
    'Needs Settings > Experimental features > Goal templates on in this budget; if it is off the call is refused and nothing changes. Needs an envelope budget. ' +
    'Money of a group source that has no sink goes to the global sink. A second run finds nothing left to move. ' +
    'Returns { month, verified, changes: [{ categoryId, name, before, after }] } from re-reading the month; changes is empty when nothing moved. ' +
    'A notice field appears when Actual reported a warning (not enough funds, or some sources could not be swept); the money that could move did. ' +
    'verified false means the month was still changing when the wait ended: re-read it with actual_budgets_get_month. Never retry a call that errored without re-reading the month first.',
  schema: z.object({
    month: CommonSchemas.monthYear.describe('Budget month as YYYY-MM, one the budget has (actual_budgets_get_months lists them)'),
  }).strict(),
  handler: async ({ month }) => {
    return await adapter.runBudgetCleanup(month);
  },
  examples: [
    { description: 'Run cleanup for a month', input: { month: '2026-11' } },
  ],
});
