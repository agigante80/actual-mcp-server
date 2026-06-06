import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_tags_create',
  description:
    'Create a new tag in Actual Budget. The "tag" field is the raw word WITHOUT a leading "#" character ' +
    '(e.g. use "groceries", not "#groceries"). ' +
    'IMPORTANT: this operation is an upsert on the tag word. If a tag with the same name already exists ' +
    '(including previously deleted ones), the existing tag is updated and its id is returned. ' +
    'Creating the same tag name twice always returns the same id. ' +
    'Color convention is CSS hex (e.g. "#33aa33") but no format is enforced by the API.',
  schema: z.object({
    tag: z.string().min(1, 'tag must not be empty').describe('Tag word without "#" prefix (e.g. "groceries")'),
    color: z.string().optional().describe('Optional color string (convention: CSS hex like "#33aa33")'),
    description: z.string().optional().describe('Optional description of the tag'),
  }),
  handler: async (input) => {
    return await adapter.createTag(input);
  },
  examples: [
    {
      description: 'Create a groceries tag with a green color',
      input: { tag: 'groceries', color: '#33aa33', description: 'Food purchases' },
    },
    {
      description: 'Create a minimal tag (no color or description)',
      input: { tag: 'travel' },
    },
  ],
});
