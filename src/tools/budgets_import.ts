import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * #334: expose `@actual-app/api`'s `importBudget()`.
 *
 * TWO SIDE EFFECTS EVERY CALLER MUST KNOW, both verified against `importActual` in
 * the installed `@actual-app/api` and against a live server in the Docker E2E run:
 *
 * 1. IT CAN OVERWRITE AN EXISTING BUDGET. The budget id is taken from the ARCHIVE,
 *    not freshly generated. `importActual` closes the current budget, restores the
 *    archive under the id the archive carries, and loads it. So re-importing an
 *    export of budget X restores ONTO budget X, replacing that budget's local data.
 *    This is what makes export/import a genuine backup-and-restore pair, and it is
 *    also why an import against a budget with real data is destructive. It is only
 *    "a new budget" when the archive's id is not already present.
 * 2. IT CHANGES THE ACTIVE BUDGET. The imported budget is loaded, so the session
 *    switches to it. If the archive's id is not in the `BUDGET_N_*` registry, that
 *    budget is also outside whatever set the ACL resolved for this request, and
 *    `actual_budgets_switch` cannot reach it by name.
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
    'DESTRUCTIVE: the budget id comes from the archive, so re-importing an export REPLACES that ' +
    'budget\'s data rather than creating a copy. Never call this to "have a look at" a file. Confirm ' +
    'with the user before importing over a budget that holds real data. ' +
    'It also LOADS the imported budget, so the active budget for this session changes; if the archive\'s ' +
    'budget is not in the configured list, call actual_budgets_list_available and actual_budgets_switch ' +
    'afterwards to go back. Provide exactly one of "path" (a file on the server) or "base64" (inline contents).',
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
        `Imported the budget as id ${result.id}. This budget is now LOADED and active for this session, ` +
        'and it is not in the server\'s configured budget list. Use actual_budgets_list_available and ' +
        'actual_budgets_switch to return to a configured budget.',
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
