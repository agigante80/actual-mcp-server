import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_notes_get',
  description:
    'Get the note attached to an entity in Actual Budget. ' +
    'The id can be any entity UUID (account, category, category-group, payee) ' +
    'or the synthetic budget-month id in the form "budget-YYYY-MM" ' +
    '(e.g. "budget-2026-01" for January 2026). ' +
    'Returns the note text when one exists. ' +
    'Returns a clear "no note" result (not null) when no note has been set for the given id.',
  schema: z.object({
    id: z.string().min(1).describe(
      'Entity id: a UUID for an account/category/category-group/payee, ' +
      'or "budget-YYYY-MM" for a budget month note',
    ),
  }),
  handler: async ({ id }) => {
    const note = await adapter.getNote(id);
    if (note === null) {
      return { found: false as const, id, note: null, message: `No note set for ${id}` };
    }
    return { found: true as const, id: note.id, note: note.note };
  },
  examples: [
    {
      description: 'Get note for an account',
      input: { id: '00000000-0000-0000-0000-000000000001' },
    },
    {
      description: 'Get note for a budget month',
      input: { id: 'budget-2026-01' },
    },
  ],
});
