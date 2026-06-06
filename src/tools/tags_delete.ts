import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_tags_delete',
  description:
    'Delete a tag from Actual Budget by its UUID. ' +
    'The tag is soft-deleted (tombstoned) and will no longer appear in actual_tags_list. ' +
    'If the id does not exist, a not-found error is returned. ' +
    'Use actual_tags_list to find valid tag UUIDs.',
  schema: z.object({
    id: CommonSchemas.tagId,
  }),
  handler: async ({ id }) => {
    await adapter.deleteTag(id);
    return { success: true as const };
  },
  examples: [
    {
      description: 'Delete a tag by its UUID',
      input: { id: '00000000-0000-0000-0000-000000000001' },
    },
  ],
});
