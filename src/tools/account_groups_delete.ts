import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

/** #429: delete a custom account group (Actual 26.9.0+). */
export default createTool({
  name: 'actual_account_groups_delete',
  description:
    'Delete a custom account group. The accounts in it are NOT deleted: they become ungrouped. ' +
    'Note that upstream clears those member references best-effort under sync, so a concurrent ' +
    'assignment on another device can survive the delete; treat any account still pointing at a ' +
    'missing group as ungrouped. Refuses with a not-found error, writing nothing, when the group ' +
    'does not exist. Requires an Actual server on 26.9.0 or newer.',
  schema: z.object({
    id: CommonSchemas.accountGroupId.describe('Id of the account group to delete (actual_account_groups_list lists them)'),
  }),
  handler: async (input) => {
    await adapter.deleteAccountGroup(input.id);
    return { success: true, id: input.id };
  },
  examples: [
    { description: 'Delete a group, leaving its accounts ungrouped', input: { id: '00000000-0000-0000-0000-000000000000' } },
  ],
});
