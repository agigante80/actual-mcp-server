import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

const BUDGET_MONTH_RE = /^budget-\d{4}-\d{2}$/;

export default createTool({
  name: 'actual_notes_update',
  description:
    'Set or clear the note attached to an entity in Actual Budget. ' +
    'This is an upsert: creates the note if none exists, updates it if one does. ' +
    'Pass an empty string for note to clear it. ' +
    'The id must resolve to a known entity (account, category, category-group, payee) ' +
    'or match the pattern "budget-YYYY-MM" for a budget month note. ' +
    'Unknown ids are rejected to prevent orphan notes. ' +
    'Budget month notes support template directives such as "#template 250" and "#goal 1000".',
  schema: z.object({
    id: z.string().min(1).describe(
      'Entity id: a UUID for an account/category/category-group/payee, ' +
      'or "budget-YYYY-MM" for a budget month note',
    ),
    note: z.string().describe(
      'Note text to set. Pass an empty string to clear the note.',
    ),
  }),
  handler: async ({ id, note }) => {
    // Fast path: budget-YYYY-MM synthetic ids need no entity lookup.
    if (!BUDGET_MONTH_RE.test(id)) {
      // Validate that the id resolves to a known entity.
      // Fetch in parallel to minimise latency.
      const [accounts, categories, categoryGroups, payees] = await Promise.all([
        adapter.getAccounts(),
        adapter.getCategories(),
        adapter.getCategoryGroups(),
        adapter.getPayees(),
      ]);

      const known =
        (Array.isArray(accounts) && accounts.some((e: any) => e.id === id)) ||
        (Array.isArray(categories) && categories.some((e: any) => e.id === id)) ||
        (Array.isArray(categoryGroups) && categoryGroups.some((e: any) => e.id === id)) ||
        (Array.isArray(payees) && payees.some((e: any) => e.id === id));

      if (!known) {
        return {
          error: `Entity "${id}" not found. ` +
            'The id must be a UUID from actual_accounts_list, actual_categories_get, ' +
            'actual_category_groups_get, or actual_payees_get, ' +
            'or a budget month id like "budget-2026-01".',
        };
      }
    }

    await adapter.updateNote(id, note);

    return {
      success: true as const,
      id,
      note,
      cleared: note === '',
    };
  },
  examples: [
    {
      description: 'Set a budget template note for January 2026',
      input: { id: 'budget-2026-01', note: '#template 250' },
    },
    {
      description: 'Clear a note',
      input: { id: 'budget-2026-01', note: '' },
    },
    {
      description: 'Set a note on an account',
      input: { id: '00000000-0000-0000-0000-000000000001', note: 'Reconcile monthly' },
    },
  ],
});
