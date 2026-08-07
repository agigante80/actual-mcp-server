import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';
import config from '../config.js';

/**
 * #332: expose `@actual-app/api`'s `exportBudget()`.
 *
 * WHY THIS WRITES TO DISK INSTEAD OF RETURNING THE ZIP.
 *
 * `exportBudget()` returns the whole budget as a zip: megabytes of binary for any
 * real budget. Returning that inline would mean base64 in the JSON-RPC result,
 * which (a) floods the model's context window with unreadable payload, and (b) can
 * exceed transport limits (the HTTP body cap, and a stdio client's line buffer).
 * So the tool writes the bytes to a configured directory and returns a PATH plus
 * the metadata a caller actually needs to verify the export: byte size and sha256.
 *
 * The sha256 is what makes the export/import round trip assertable: a test can
 * export, re-import, export again, and compare digests without ever moving the
 * bytes through the transport.
 */

// Deliberately strict: a caller-supplied filename becomes a path on the server's
// filesystem, so it is restricted to a flat, boring charset. Traversal sequences,
// separators, and absolute paths are all rejected by this class rather than
// normalised away, because silently rewriting a caller's filename is worse than
// telling them it was invalid.
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const InputSchema = z
  .object({
    filename: z
      .string()
      .min(1, 'filename must not be empty')
      .max(120, 'filename must be at most 120 characters')
      .refine(
        (value) => SAFE_FILENAME.test(value),
        'filename must start with a letter or digit and contain only letters, digits, dots, underscores, and hyphens (no path separators)',
      )
      .refine((value) => !value.includes('..'), 'filename must not contain ".."')
      .optional()
      .describe(
        'Optional file name for the export, without any directory part. Defaults to a timestamped name. ' +
          'A ".zip" suffix is appended if missing.',
      ),
  })
  .strict();

/**
 * Build the default export name. Uses a UTC timestamp flattened to a
 * filesystem-safe form, e.g. `budget-export-2026-08-07T10-31-05Z.zip`.
 *
 * This is a FILE NAME, not a date field: the project rule that dates are
 * `YYYY-MM-DD` strings applies to values sent to the Actual API, none of which
 * this touches.
 */
function defaultExportName(now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return `budget-export-${stamp}.zip`;
}

export default createTool({
  name: 'actual_budgets_export',
  description:
    'Export the currently active budget as an Actual Budget ".zip" file, written to the server\'s ' +
    'configured export directory (ACTUAL_EXPORT_DIR). Returns the file path, byte size, and sha256 ' +
    'digest, NOT the file contents: a budget export is megabytes of binary and is never inlined into ' +
    'the response. The resulting file can be restored with actual_budgets_import, or downloaded from ' +
    'the server by whoever operates it. Use this before any bulk or destructive change as a backup.',
  schema: InputSchema,
  handler: async (input: z.infer<typeof InputSchema>) => {
    const data = await adapter.exportBudget();

    // Guard the upstream contract rather than assuming it. `exportBudget` is a
    // young method (added upstream in July 2026) and its own error path already
    // throws on a missing payload, but a zero-length buffer would slip through and
    // produce a silently useless "backup", which is the worst possible failure for
    // a backup tool.
    if (!data || data.length === 0) {
      throw new Error(
        'Actual Budget returned an empty export. The budget may not be fully loaded; ' +
          'retry after confirming the budget is open, and check the server logs.',
      );
    }

    const requested = input.filename ? basename(input.filename) : defaultExportName(new Date());
    const filename = requested.toLowerCase().endsWith('.zip') ? requested : `${requested}.zip`;

    // An unset ACTUAL_EXPORT_DIR derives from the data dir rather than the CWD.
    // See the config comment: the CWD in the container is root-owned /app, and
    // the runtime user is unprivileged, so a CWD-relative default cannot be
    // created. MCP_BRIDGE_DATA_DIR is writable and persisted by construction.
    const configured = config.ACTUAL_EXPORT_DIR.trim();
    const target = configured || join(config.MCP_BRIDGE_DATA_DIR, 'exports');
    const dir = isAbsolute(target) ? target : resolve(process.cwd(), target);
    await mkdir(dir, { recursive: true });

    const path = join(dir, filename);
    await writeFile(path, data);

    const sha256 = createHash('sha256').update(data).digest('hex');

    return {
      success: true,
      path,
      filename,
      directory: dir,
      bytes: data.length,
      sha256,
      message:
        `Exported the active budget to ${path} (${data.length} bytes, sha256 ${sha256}). ` +
        'Restore it with actual_budgets_import using this path.',
    };
  },
  examples: [
    { description: 'Export the active budget with an auto-generated timestamped name', input: {} },
    { description: 'Export to a specific file name', input: { filename: 'before-cleanup.zip' } },
  ],
});
