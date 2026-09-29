import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * actual_get_context (#484)
 *
 * Outcome-oriented tool returning high-level budget structure (accounts,
 * category groups with nested categories, and payees) with IDs in one call.
 *
 * Call this first to bootstrap context for an assistant so you have the UUIDs
 * needed for transactions, rules, or budget queries without multiple sequential
 * list calls.
 *
 * Read-only.
 */
const schema = z.object({
  include_accounts: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include active accounts in response (default: true).'),
  include_categories: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include category groups with nested categories in response (default: true).'),
  include_payees: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include payees list in response (default: true).'),
  include_closed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include closed accounts (default: false).'),
  payee_limit: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .default(500)
    .describe(
      'Maximum number of payees to return (1 to 2000, default: 500). When payees exceed this limit, payees_truncated is set to true; use actual_entities_search or actual_get_id_by_name for others.',
    ),
});

export default createTool<z.input<typeof schema>>({
  name: 'actual_get_context',
  description:
    'Read high-level budget structure and entity UUIDs (accounts, category groups with nested categories, and payees) in a single call. ' +
    'Call this first to bootstrap budget context so you have the IDs needed for transactions, rules, or budget operations without sequential list queries. ' +
    'Read-only.',
  schema,
  handler: async (input) => {
    return await adapter.getContext(input);
  },
  examples: [
    {
      description: 'Bootstrap budget context with active accounts, categories, and up to 500 payees',
      input: {},
    },
    {
      description: 'Fetch accounts and categories without reading payees',
      input: { include_payees: false },
    },
  ],
});
