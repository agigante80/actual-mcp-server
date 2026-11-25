import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

/**
 * EXPERIMENTAL (feature `budget_automations`, MCP_EXPERIMENTAL): published only when the operator
 * names the feature. A pure read: it never writes and works with the budget's Goal templates flag off.
 */
export default createTool({
  name: 'actual_categories_get_automations',
  description:
    'Experimental (MCP_EXPERIMENTAL=budget_automations; may break on an Actual upgrade). Read one category\'s budget automations (Goal templates) and cleanup. ' +
    'source "ui" (editor-managed): returns automations in Actual\'s field names, with money fields (amount, monthly, limit.amount, fixed adjustment) as integer minor units of the budget currency, ' +
    'plus errors for any stored entry that is malformed or of an unknown type. ' +
    'source "notes": returns noteDirectives, the #template, #goal and #cleanup lines of the category note as written (empty when there are none). ' +
    'cleanup lists the stored cleanup roles with groupName. An unknown categoryId is refused. Writes nothing.',
  schema: z.object({
    categoryId: CommonSchemas.categoryId.describe('Category UUID, from actual_categories_get'),
  }).strict(),
  handler: async ({ categoryId }) => {
    return await adapter.getCategoryAutomations(categoryId);
  },
  examples: [
    {
      description: 'Read the automations of a category',
      input: { categoryId: '00000000-0000-4000-8000-000000000001' },
    },
  ],
});
