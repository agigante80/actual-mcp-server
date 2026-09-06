import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/** #429: create a custom account group (Actual 26.9.0+). */
export default createTool({
  name: 'actual_account_groups_create',
  description:
    'Create a custom account group for organising accounts in the sidebar. ' +
    'Returns the id of the new group. Assigning accounts to it is a separate step: ' +
    'set the account\'s account_group_id with actual_accounts_update. ' +
    'Requires an Actual server on 26.9.0 or newer.',
  schema: z.object({
    name: z.string().min(1).describe('Display name for the group, for example "Savings" or "Joint accounts"'),
    sort_order: z
      .number()
      .optional()
      .describe('Optional ordering position in the sidebar. Lower sorts first; omit to let Actual place it.'),
  }),
  handler: async (input) => {
    const id = await adapter.createAccountGroup(input);
    return { id, name: input.name };
  },
  examples: [
    { description: 'Create a group for savings accounts', input: { name: 'Savings' } },
    { description: 'Create a group pinned to the top of the sidebar', input: { name: 'Daily spending', sort_order: 0 } },
  ],
});
