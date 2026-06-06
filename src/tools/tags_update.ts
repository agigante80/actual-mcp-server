import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_tags_update',
  description:
    'Update an existing tag in Actual Budget. At least one of tag/color/description must be provided. ' +
    'The id must be a valid UUID from actual_tags_list. ' +
    'If the id does not exist, a not-found error is returned (the API would silently no-op; this tool adds a pre-flight guard). ' +
    'The "tag" field is the raw word WITHOUT a leading "#" character.',
  schema: z.object({
    id: CommonSchemas.tagId,
    tag: z.string().min(1, 'tag must not be empty').optional().describe('New tag word without "#" prefix'),
    color: z.string().optional().describe('New color string (convention: CSS hex like "#112233")'),
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
