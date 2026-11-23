import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

/** #429: rename a custom account group (Actual 26.9.0+). #817: the name is the only field Actual stores. */
export default createTool({
  name: 'actual_account_groups_update',
  description:
    'Rename a custom account group. ' +
    'Does not change which accounts belong to it: use actual_accounts_update ' +
    'account_group_id to move an account between groups. Refuses with a not-found error, writing nothing, when the group ' +
    'does not exist. Requires an Actual server on 26.9.0 or newer.',
  schema: z.object({
    id: CommonSchemas.accountGroupId.describe('Id of the account group to update (actual_account_groups_list lists them)'),
    name: z.string().min(1).describe('New display name'),
  }),
  handler: async (input) => {
    await adapter.updateAccountGroup(input.id, { name: input.name });
    return { success: true, id: input.id, updated: ['name'] };
  },
  examples: [
    { description: 'Rename a group', input: { id: '00000000-0000-0000-0000-000000000000', name: 'Long-term savings' } },
  ],
});
