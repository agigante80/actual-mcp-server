import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * #334: expose `@actual-app/api`'s `importBudget()`.
 *
 * WHAT A CALL DOES, verified against `importActual` and `importBuffer` in the installed
 * `@actual-app/api` and against a live server (#687, 2026-11-18):
 *
 * 1. IT ADDS A BUDGET AND REPLACES NOTHING. `importActual` passes no local id, so the
 *    archive lands in a NEW local directory under a fresh id (a YNAB import derives
 *    its id from the budget name), next to the copy it was exported from. On the
 *    SERVER it never overwrites anything either (#570): the cloud file and group ids
 *    are cleared and the result is uploaded as a NEW budget file (best effort; a
 *    failed upload leaves it local only). No tool here removes that file.
 *    A session with a restricted budget ACL is refused this tool outright (#570).
 * 2. THE SESSION DOES NOT MOVE. Upstream closes the open budget and loads the
 *    imported one, but `importBudgetTracked` records an `imported:` sentinel, so the
 *    next operation of EVERY session (this one included) reloads that session's own
 *    configured budget. A write sent after the import lands in the configured
 *    budget. The imported budget has a Sync ID no `BUDGET_N_*` entry names, so
 *    `actual_budgets_switch` cannot reach it: an operator has to add that Sync ID to
 *    the configuration and restart. The returned id is the LOCAL id, not a Sync ID.
 *
 * The write queue enforces the budget ACL when this is enqueued, so this cannot be
 * used to reach a budget the caller was already denied. It does mean a budget
 * created by the import is un-ACL'd, because it did not exist when the ACL was built.
 *
 * Accepts either a path on the server's filesystem or the file contents inline as
 * base64. Exactly one, enforced by the schema.
 */

// A generous ceiling that still turns a runaway payload into a clear validation
// error instead of an out-of-memory kill. ~64 MB of base64 is ~48 MB of zip, far
// above any realistic Actual export. Consistent with the bounded-input policy the
// rest of the tool surface adopted in #156.
const MAX_BASE64_CHARS = 64 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const InputSchema = z
  .object({
    path: z
      .string()
      .min(1, 'path must not be empty')
      .max(4096, 'path must be at most 4096 characters')
      .optional()
      .describe(
        'Absolute or relative path to the export file ON THE SERVER\'S filesystem. ' +
          'Use the "path" returned by actual_budgets_export to restore an earlier export.',
      ),
    base64: z
      .string()
      .min(1, 'base64 must not be empty')
      .max(MAX_BASE64_CHARS, `base64 must be at most ${MAX_BASE64_CHARS} characters`)
      .refine((value) => BASE64.test(value), 'base64 must be valid base64 (A-Z, a-z, 0-9, +, /, with optional = padding)')
      .optional()
      .describe('The export file contents, base64-encoded, for callers that cannot place a file on the server.'),
    type: z
      .enum(['actual', 'ynab4', 'ynab5'])
      .default('actual')
      .describe(
        'Format of the file being imported. "actual" is an Actual Budget .zip export ' +
          '(what actual_budgets_export produces). "ynab4" and "ynab5" import from YNAB.',
      ),
    filename: z
      .string()
      .min(1, 'filename must not be empty')
      .max(120, 'filename must be at most 120 characters')
      .optional()
      .describe('Original file name, used only with "base64" so the importer can infer the budget name.'),
  })
  .strict()
  .refine(
    (value) => Boolean(value.path) !== Boolean(value.base64),
    'Provide exactly one of "path" or "base64", not both and not neither.',
  );

export default createTool({
  name: 'actual_budgets_import',
  description:
    'Restore or import a budget from an Actual Budget ".zip" export or a YNAB4/YNAB5 export. ' +
    'It ADDS a budget and replaces none: each import makes a new local copy and normally uploads it to the ' +
    'Actual server as a NEW budget file that no tool here can remove. Never call this to "have a look at" a file; ' +
    'confirm with the user first. This session STAYS on its own configured budget: later calls do not reach the ' +
    'imported budget. To use it, an operator adds its Sync ID to the server configuration and restarts. ' +
    'Provide exactly one of "path" (a file on the server) or "base64" (inline contents).',
  schema: InputSchema,
  handler: async (input: z.infer<typeof InputSchema>) => {
    const source = input.path
      ? (input.path as string | Uint8Array)
      : (new Uint8Array(Buffer.from(input.base64 as string, 'base64')) as string | Uint8Array);

    // Reject an empty decode explicitly. Buffer.from(..., 'base64') is lenient and
    // returns an empty buffer for input it cannot decode, which would otherwise
    // reach upstream as a zero-byte zip and fail with a much less useful message.
    if (typeof source !== 'string' && source.length === 0) {
      throw new Error('The "base64" payload decoded to zero bytes. Check that it is a complete, valid base64 string.');
    }

    const result = await adapter.importBudget(source, {
      type: input.type,
      ...(input.filename ? { filename: input.filename } : {}),
    });

    return {
      success: true,
      budgetId: result.id,
      type: input.type,
      source: input.path ? 'path' : 'base64',
      message:
        `Imported the budget as a new local copy (id ${result.id}); it is normally also uploaded to the Actual ` +
        'server as a new budget file. This session stays on its configured budget: later calls do NOT reach the ' +
        'imported budget, and nothing was replaced. To use the imported budget, an operator adds its Sync ID ' +
        '(in Actual: Settings, Advanced settings) to this server\'s configuration and restarts it.',
    };
  },
  examples: [
    {
      description: 'Restore an export previously produced by actual_budgets_export',
      input: { path: './actual-data/exports/before-cleanup.zip', type: 'actual' as const },
    },
    {
      description: 'Import a YNAB5 export sent inline',
      input: { base64: 'UEsDBBQAAAAIA...', type: 'ynab5' as const, filename: 'my-ynab-budget.zip' },
    },
  ],
});
