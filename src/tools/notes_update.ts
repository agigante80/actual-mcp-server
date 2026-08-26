import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';
import { isPreflightRefusal } from '../lib/errors.js';

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
    // #376: the orphan-id guard lives in `adapter.updateNote`, which reads and writes in
    // ONE write-queue cycle. It used to sit here as four `adapter.get*` calls plus the
    // write, which was five api lock acquisitions for one operation; `Promise.all` made
    // that look concurrent, but the api mutex is process-global so they serialised anyway.
    //
    // This tool answers a refusal with `{ error }` rather than throwing. That shape is a
    // documented deviation from the refusal taxonomy (see the api-design-principles skill)
    // and it is this tool's PUBLISHED contract, so it is preserved here rather than
    // quietly changed; #377 tracks the decision. What did change is that the shape is
    // chosen by TYPE now, not by matching the message.
    try {
      await adapter.updateNote(id, note);
    } catch (error) {
      if (isPreflightRefusal(error)) {
        return { error: (error as Error).message };
      }
      throw error;
    }

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
