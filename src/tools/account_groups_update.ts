import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

/** #429: rename or reorder a custom account group (Actual 26.9.0+). */
export default createTool({
  name: 'actual_account_groups_update',
  description:
    'Rename a custom account group or change its sidebar position. ' +
    'Does not change which accounts belong to it: use actual_accounts_update to move an ' +
    'account between groups. Refuses with a not-found error, writing nothing, when the group ' +
    'does not exist. Requires an Actual server on 26.9.0 or newer.',
  schema: z.object({
    id: CommonSchemas.accountGroupId.describe('Id of the account group to update (actual_account_groups_list lists them)'),
    name: z.string().min(1).optional().describe('New display name'),
    sort_order: z.number().optional().describe('New ordering position in the sidebar; lower sorts first'),
  }),
  handler: async (input) => {
    const { id, ...fields } = input;
    await adapter.updateAccountGroup(id, fields);
    return { success: true, id, updated: Object.keys(fields) };
  },
  examples: [
    { description: 'Rename a group', input: { id: '00000000-0000-0000-0000-000000000000', name: 'Long-term savings' } },
  ],
});
