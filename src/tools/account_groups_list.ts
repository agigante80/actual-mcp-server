import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * #429: list the custom account groups (Actual 26.9.0+).
 *
 * Read the grouping semantics before relying on a group id: upstream clears member
 * references on a best-effort basis under CRDT sync, so an account whose
 * `account_group_id` points at a group that is missing here is UNGROUPED, not an error.
 */
export default createTool({
  name: 'actual_account_groups_list',
  description:
    'List the custom account groups used to organise accounts in the sidebar. ' +
    'Returns each group with its id, name and sort order. An account whose account_group_id ' +
    'does not appear here is ungrouped: upstream clears member references best-effort under ' +
    'sync, so a dangling reference is expected and is not an error. Requires an Actual server ' +
    'on 26.9.0 or newer, which is where account groups were introduced.',
  schema: z.object({}),
  handler: async () => {
    return await adapter.getAccountGroups();
  },
  examples: [{ description: 'List every account group', input: {} }],
});
