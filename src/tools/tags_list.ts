import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_tags_list',
  description:
    'List the tag list of Actual Budget: id, tag (the word without "#"), optional color and description. ' +
    'A tag is the "#word" in transaction notes; tags used only in notes are not listed.',
  schema: z.object({}),
  handler: async () => {
    return await adapter.getTags();
  },
  examples: [
    { description: 'List all tags', input: {} },
  ],
});
