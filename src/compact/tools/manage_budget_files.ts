import { budgetSelectorRule, showDiscoveredBudgets, validBudgetSelector } from '../../lib/budgetSelector.js';
import { z } from 'zod';
import { asFields, issue, needs, strict } from '../refine.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * manage_budget_files (#678): the compact front for the three budget file tools. Selector
 * `action` is required. Nothing here imports the adapter. Session administration (the session
 * tools) stays out of it (#670).
 *
 * Mapping (#670 section 7): switch -> actual_budgets_switch (budget_name -> budgetName),
 * import -> actual_budgets_import, export -> actual_budgets_export.
 *
 * WRITE tool: all three legacy tools are in WRITE_CAPABLE. No schema carries a `.default()`:
 * an omitted import `type` is not forwarded, so the legacy default `actual` applies.
 *
 * Shared key `filename` is ONE schema object: import uses it as the original file name of a
 * base64 upload, export as the output name. Each action's refine applies its own legacy rule.
 * `budget_name` is checked with a refine, never a regex (#293: a `\p{L}` pattern breaks the
 * OpenAI function-schema validator).
 */

const budgetName = z.string().optional().describe((showDiscoveredBudgets ? 'Exact budget name or, in discovery mode, Sync ID' : 'Exact configured budget name') + ' (list with list_entities type budget_file), case-insensitive, max 120 characters.');
const path = z.string().optional().describe('import: path of the export file ON THE SERVER; give exactly one of path and base64.');
const base64 = z.string().optional().describe('import: the export file contents, base64-encoded; give exactly one of path and base64.');
const type = z.enum(['actual', 'ynab4', 'ynab5']).optional().describe('import: format; omit for actual (an Actual .zip export).');
const filename = z
  .string()
  .optional()
  .describe('import: original file name, only with base64. export: output name without a directory, letters, digits, dot, underscore, hyphen; ".zip" is appended; omit for a timestamped name. Max 120.');


const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_CHARS = 64 * 1024 * 1024;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const BUDGET_NAME = z
  .string()
  .min(1, 'budget_name must not be empty')
  .max(120, 'budget_name must be at most 120 characters')
  .refine(validBudgetSelector, budgetSelectorRule('budget_name'));
const PATH = z.string().min(1, 'path must not be empty').max(4096, 'path must be at most 4096 characters');
const BASE64_REAL = z
  .string()
  .min(1, 'base64 must not be empty')
  .max(MAX_BASE64_CHARS, `base64 must be at most ${MAX_BASE64_CHARS} characters`)
  .refine((value) => BASE64.test(value), 'base64 must be valid base64 (A-Z, a-z, 0-9, +, /, with optional = padding)');
const IMPORT_FILENAME = z.string().min(1, 'filename must not be empty').max(120, 'filename must be at most 120 characters');
const EXPORT_FILENAME = z
  .string()
  .min(1, 'filename must not be empty')
  .max(120, 'filename must be at most 120 characters')
  .refine(
    (value) => SAFE_FILENAME.test(value),
    'filename must start with a letter or digit and contain only letters, digits, dots, underscores, and hyphens (no path separators)',
  )
  .refine((value) => !value.includes('..'), 'filename must not contain ".."');

type V = Record<string, unknown>;

const switchFields = asFields(
  z.object({ budget_name: budgetName }).superRefine((value, ctx) => {
    needs('switch', ctx, value as V, ['budget_name']);
    strict(ctx, value as V, { budget_name: BUDGET_NAME });
  }),
);
const importFields = asFields(
  z.object({ path, base64, type, filename }).superRefine((value, ctx) => {
    const v = value as V;
    strict(ctx, v, { path: PATH, base64: BASE64_REAL, filename: IMPORT_FILENAME });
    if ((v.path !== undefined) === (v.base64 !== undefined)) issue(ctx, 'path', 'Provide exactly one of "path" or "base64", not both and not neither.');
  }),
);
const exportFields = asFields(
  z.object({ filename }).superRefine((value, ctx) => {
    strict(ctx, value as V, { filename: EXPORT_FILENAME });
  }),
);

export const manageBudgetFiles: CompactToolSpec = {
  name: 'manage_budget_files',
  domain: 'Changing data',
  summary: 'Switch the active budget, import a budget file or export the active budget.',
  examplePrompt: 'Export my budget to a file.',
  description:
    'Switch the active budget, import a budget file, or export the active budget to a file; pick one `action`. To list the ' + (showDiscoveredBudgets ? 'available budget names use' : 'configured budget names use') + ' list_entities with type budget_file; budget months are manage_budget_months. Other fields are refused.\n' +
    'switch: budget_name; takes effect now in this session; other open sessions keep theirs; remembered per caller, so a new session of the same caller starts on it (holders of the one legacy bearer token are one caller); an unconfigured or not permitted name is refused. Locked budgets cannot be switched to.\n' +
    'switch loads the target budget, and a load failure can surface on the next call instead; undo it by switching back.\n' +
    'import: exactly one of path (a file on the server, max 4096 characters) or base64 (max 67108864 characters); optional type (actual, ynab4, ynab5; default actual), filename (base64 only); a caller limited to some budgets is refused; a long import can time out.\n' +
    'import ADDS a budget and replaces nothing: each import makes a new local copy and normally uploads it as a NEW server budget file (a failed upload leaves it local only); the returned budgetId is that local id, not a Sync ID; confirm before importing.\n' +
    'After an import, success or failure, the next call from every session (this one included) reloads that session\'s own configured budget, so later calls do not reach the imported budget; to use it, an operator adds its Sync ID to the server configuration. Nothing removes the uploaded server file.\n' +
    'export: optional filename; writes the whole active budget (every account and transaction) as a .zip into the server\'s export directory and OVERWRITES a file of the same name; the file contents are not returned; only deleting the file on the server host removes it.\n' +
    'Returns { success, budgetName, budgetId, serverUrl, message } (switch), { result: { success, budgetId, type, source, message } } (import), { result: { success, path, filename, directory, bytes, sha256, message } } (export).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['switch', { legacy: 'actual_budgets_switch', fields: switchFields, rename: { budget_name: 'budgetName' } }],
    ['import', { legacy: 'actual_budgets_import', fields: importFields }],
    ['export', { legacy: 'actual_budgets_export', fields: exportFields }],
  ]),
};
