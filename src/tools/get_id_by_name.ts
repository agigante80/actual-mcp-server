import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const ALLOWED_TYPES = ['accounts', 'schedules', 'categories', 'payees'] as const;

const InputSchema = z.object({
  type: z
    .enum(ALLOWED_TYPES)
    .describe("Entity type to look up. One of: 'accounts', 'schedules', 'categories', 'payees'"),
  name: z
    .string()
    .min(1, 'Name cannot be empty')
    .describe('Exact name of the entity to resolve to an ID'),
});

const tool: ToolDefinition = {
  name: 'actual_get_id_by_name',
  description: `Resolve an entity name to its UUID.

Looks up the UUID for any Account, Payee, Category, or Schedule by their display name.
This is useful when you know the human-readable name but need the ID for other API calls.

Allowed types: 'accounts', 'schedules', 'categories', 'payees'

Returns the UUID string for the matching entity.

Examples:
- Find the ID for an account named "Checking Account"
- Find the ID for a category named "Groceries"
- Find the ID for a payee named "Amazon"
- Find the ID for a schedule named "Rent"`,
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    const id = await adapter.getIDByName(input.type, input.name);
    return { id, type: input.type, name: input.name };
  },
};

export default tool;
