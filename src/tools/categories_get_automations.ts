import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

export default createTool({
  name: 'actual_categories_get_automations',
  description:
    "Get one category's budget automations and cleanup from the loaded budget. For an editor-managed category, returns saved automations and cleanup in Actual's field names, with amounts in cents. " +
    'For a note-managed category, returns the current #template, #goal and #cleanup directives as written. Works with Goal templates off.',
  schema: z.object({ categoryId: CommonSchemas.categoryId }).strict(),
  handler: async ({ categoryId }) => adapter.getCategoryAutomations(categoryId),
});
