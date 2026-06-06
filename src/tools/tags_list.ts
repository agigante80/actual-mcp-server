import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_tags_list',
  description:
    'List all tags defined in Actual Budget. Tags are stored without a leading "#" character ' +
    '(e.g. "groceries", not "#groceries"). Returns id, tag (the word), and optional color and description fields.',
  schema: z.object({}),
  handler: async () => {
    return await adapter.getTags();
  },
  examples: [
    { description: 'List all tags', input: {} },
  ],
});
