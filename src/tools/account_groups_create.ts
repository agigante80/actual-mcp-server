import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/** #429: create a custom account group (Actual 26.9.0+). */
export default createTool({
  name: 'actual_account_groups_create',
  description:
    'Create a custom account group for organising accounts in the sidebar. ' +
    'Returns the id of the new group. Assigning accounts to it is a separate step: ' +
    'assign an account with actual_accounts_update account_group_id. ' +
    'Requires an Actual server on 26.9.0 or newer.',
  schema: z.object({
    name: z.string().min(1).describe('Display name for the group, for example "Savings" or "Joint accounts"'),
  }),
  handler: async (input) => {
    const id = await adapter.createAccountGroup({ name: input.name });
    return { id, name: input.name };
  },
  examples: [
    { description: 'Create a group for savings accounts', input: { name: 'Savings' } },
    { description: 'Create a group for everyday accounts', input: { name: 'Daily spending' } },
  ],
});
