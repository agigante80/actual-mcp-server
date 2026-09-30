import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * actual_get_context (#484)
 *
 * One call that returns the ids an assistant needs before it can do anything else: accounts,
 * category groups with their categories, and payees, read in a single api session.
 *
 * The name follows the actual_get_id_by_name precedent: a cross-entity snapshot has no single
 * domain noun for actual_{domain}_{action}. Read-only.
 */
const schema = z
  .object({
    includeAccounts: z.boolean().optional().default(true)
      .describe('Include accounts (default: true).'),
    includeCategories: z.boolean().optional().default(true)
      .describe('Include category groups with their categories, hidden ones flagged (default: true).'),
    includePayees: z.boolean().optional().default(true)
      .describe('Include payees (default: true).'),
    includeClosed: z.boolean().optional().default(false)
      .describe('Include closed accounts and their transfer payees (default: false).'),
    payeeLimit: z.number().int().min(1).max(2000).optional().default(500)
      .describe(
        'Maximum payees to return, 1 to 2000 (default: 500). Payees are sorted by name; when more exist, payeesTruncated is true and payeeTotal gives the full count. Use actual_entities_search or actual_get_id_by_name for the rest.',
      ),
  })
  .refine((v) => v.includeAccounts || v.includeCategories || v.includePayees, {
    message: 'At least one of includeAccounts, includeCategories or includePayees must be true.',
    path: ['includeAccounts'],
  });

export default createTool<z.input<typeof schema>>({
  name: 'actual_get_context',
  description:
    'Read the budget structure and entity UUIDs (accounts, category groups with nested categories, and payees) in a single call. ' +
    'Call this first to bootstrap context so you have the ids needed for transactions, rules, or budget operations without several list calls. ' +
    'A section you exclude is omitted from the response rather than returned empty. Read-only.',
  schema,
  handler: async (input) => {
    return await adapter.getContext(input);
  },
  examples: [
    {
      description: 'Bootstrap budget context with open accounts, categories, and up to 500 payees',
      input: {},
    },
    {
      description: 'Fetch accounts and categories without reading payees',
      input: { includePayees: false },
    },
  ],
});
