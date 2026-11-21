import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_tags_update',
  description:
    'Update an existing tag in Actual Budget. At least one of tag/color/description must be provided. ' +
    'The id must be a valid UUID from actual_tags_list; an unknown id returns a not-found error. ' +
    'The "tag" field is the raw word WITHOUT a leading "#" character. ' +
    'A rename does not change transaction notes, which keep the old #word.',
  schema: z.object({
    id: CommonSchemas.tagId,
    tag: CommonSchemas.tagName.optional(),
    color: CommonSchemas.tagColor.optional(),
    description: z.string().optional().describe('New description'),
  }).refine(
    (data) => data.tag !== undefined || data.color !== undefined || data.description !== undefined,
    { message: 'At least one of tag, color, or description must be provided' }
  ),
  handler: async ({ id, tag, color, description }) => {
    const fields: { tag?: string; color?: string; description?: string } = {};
    if (tag !== undefined) fields.tag = tag;
    if (color !== undefined) fields.color = color;
    if (description !== undefined) fields.description = description;
    await adapter.updateTag(id, fields);
    return { success: true as const };
  },
  examples: [
    {
      description: 'Rename a tag and change its color',
      input: { id: '00000000-0000-0000-0000-000000000001', tag: 'food', color: '#112233' },
    },
    {
      description: 'Update only the description',
      input: { id: '00000000-0000-0000-0000-000000000001', description: 'Updated description' },
    },
  ],
});
