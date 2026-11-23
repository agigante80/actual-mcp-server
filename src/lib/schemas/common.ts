/**
 * Shared Zod Validation Schemas
 * 
 * Common validation schemas used across MCP tools for Actual Budget.
 * These schemas provide consistent validation, better error messages,
 * and reduce duplication across the 85 tool definitions.
 */

import { z } from 'zod';
import { isCalendarDay } from '../dates.js';
import { MAX_BUDGET_AMOUNT_CENTS } from '../budget-limits.js';
import { 
  MAX_NAME_LENGTH, 
  MAX_NOTES_LENGTH, 
  DATE_PATTERN, 
  MONTH_PATTERN, 
  UUID_PATTERN 
} from '../constants.js';

// ============================================================================
// ID SCHEMAS
// ============================================================================

/**
 * Account UUID validation
 * Used for: account operations, transactions, transfers
 */
export const accountIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid account ID format (expected UUID)')
  .describe('Account UUID');

/**
 * Transaction UUID validation
 * Used for: transaction updates, deletions
 */
export const transactionIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid transaction ID format (expected UUID)')
  .describe('Transaction UUID');

/**
 * Category UUID validation
 * Used for: budget operations, transactions, category management
 */
export const categoryIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid category ID format (expected UUID)')
  .describe('Category UUID');

/**
 * Category group UUID validation
 * Used for: category group management
 */
export const categoryGroupIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid category group ID format (expected UUID)')
  .describe('Category group UUID; list with actual_category_groups_get');

/**
 * Payee UUID validation
 * Used for: transactions, payee management, rules
 */
export const payeeIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid payee ID format (expected UUID)')
  .describe('Payee UUID');

/**
 * Rule UUID validation
 * Used for: rule management operations
 */
export const ruleIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid rule ID format (expected UUID)')
  .describe('Rule UUID');

/**
 * Tag UUID validation
 * Used for: tag management operations (update, delete)
 */
/**
 * Account group UUID validation (#429)
 * Used for: account group management operations (update, delete)
 */
export const accountGroupIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid account group ID format (expected UUID)')
  .describe('Account group UUID');

export const tagIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid tag ID format (expected UUID)')
  .describe('Tag UUID');

/**
 * Tag name (#699). A tag is the `#word` written in a transaction's notes, and upstream
 * extracts it with `/(?<!#)#([^#\s]+)/g`, so a name holding "#" or whitespace can never
 * match a note. The pattern is the one upstream's own rename uses (`/^[^#\s]+$/`). No
 * trimming: " a " is refused, not silently rewritten. Applied on create and on the NEW
 * name of an update only, never on a lookup by id, so a bad row that already exists can
 * still be renamed and deleted.
 */
export const TAG_NAME_PATTERN = /^[^#\s]+$/;
export const tagNameSchema = z
  .string()
  .regex(TAG_NAME_PATTERN, 'tag must be one word: no "#" and no whitespace')
  .describe('Tag word, no "#", no spaces');

/**
 * Tag colour (#699): "#" plus exactly six hex digits. The upstream API stores any string, but
 * the Actual UI accepts only this form (TagCreationRow.tsx tests /^#[0-9a-fA-F]{6}$/ and the
 * tag editor writes the picker's hex string), so anything else is a colour the UI itself could
 * never have produced. On create, "no colour" is expressed by omitting the field; on update an
 * omitted colour keeps the stored one, and no tool can clear a colour (not supported).
 */
export const TAG_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const tagColorSchema = z
  .string()
  .regex(TAG_COLOR_PATTERN, 'color must be a 6 digit hex colour such as "#33aa33"')
  .describe('6 digit hex, e.g. "#33aa33"');

/**
 * Schedule UUID validation
 * Used for: schedule management operations (update, delete)
 *
 * #380: added because `schedules_update` and `schedules_delete` were inlining
 * `UUID_PATTERN` directly, which is the same rule expressed twice and is how a fifth way
 * of describing an id appears.
 */
export const scheduleIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid schedule ID format (expected UUID)')
  .describe('Schedule UUID');

// ============================================================================
// DATE SCHEMAS
// ============================================================================

/**
 * A real calendar day in YYYY-MM-DD format (2018-02-30 is refused, #745). The published JSON
 * pattern stays shape-only: it cannot express leap years, and Zod being stricter is the safe direction.
 * Used for: transactions, account balance queries, date range filters
 * Example: "2025-11-24"
 */
export const dateSchema = z
  .string()
  // abort: true stops at a bad shape, so a malformed string yields the shape message only (Zod 4
  // runs a refine after a failed regex otherwise).
  .regex(DATE_PATTERN, { message: 'Invalid date format (expected YYYY-MM-DD)', abort: true })
  .refine(isCalendarDay, 'Invalid date (not a real calendar day)')
  .describe('Date in YYYY-MM-DD format');

/**
 * The one-off branch of a schedule `date` union (#745). dateSchema aborts on a bad shape, and Zod 4
 * then counts the whole branch as aborted, so a union of it and the recurrence object would answer
 * a malformed string with a bare "Invalid input". This variant does not abort: the calendar refine
 * skips a malformed shape, so exactly one issue (shape or calendar) surfaces from the one branch.
 */
export const oneOffDateSchema = z
  .string()
  .regex(DATE_PATTERN, 'Invalid date format (expected YYYY-MM-DD)')
  .refine((v) => !DATE_PATTERN.test(v) || isCalendarDay(v), 'Invalid date (not a real calendar day)');

/**
 * Month in YYYY-MM format
 * Used for: budget months, monthly reports
 * Example: "2025-11"
 */
export const monthYearSchema = z
  .string()
  .regex(MONTH_PATTERN, 'Invalid month format (expected YYYY-MM)')
  .describe('Month in YYYY-MM format');

// ============================================================================
// AMOUNT SCHEMAS
// ============================================================================

/**
 * Amount in cents (integer)
 * Negative for expenses, positive for income
 * Example: -12.34 USD = -1234 cents
 */
export const amountCentsSchema = z
  .number()
  .int('Amount must be an integer (cents)')
  .describe('Amount in cents (negative for expenses, positive for income)');

/**
 * A budget amount in cents (#759): `amountCents` bounded to what Actual can store.
 * Upstream `safeNumber` allows only 2 ** 51 - 1, well under the `.int()` bound of 2 ** 53 - 1.
 */
export const budgetAmountCentsSchema = z
  .number()
  .int('Amount must be an integer (cents)')
  .min(-MAX_BUDGET_AMOUNT_CENTS, `amount must be at least -${MAX_BUDGET_AMOUNT_CENTS} (the limit Actual can store)`)
  .max(MAX_BUDGET_AMOUNT_CENTS, `amount must be at most ${MAX_BUDGET_AMOUNT_CENTS} (the limit Actual can store)`)
  .describe('Budget amount in cents, at most 2251799813685247 either way');

/**
 * Optional amount in cents
 * Used for: account balance initialization, optional transaction amounts
 */
export const optionalAmountCentsSchema = amountCentsSchema
  .optional()
  .describe('Optional amount in cents');

// ============================================================================
// TEXT FIELD SCHEMAS
// ============================================================================

/**
 * Name field (1-255 characters)
 * Used for: accounts, categories, payees, category groups
 */
export const nameSchema = z
  .string()
  .min(1, 'Name cannot be empty')
  .max(MAX_NAME_LENGTH, `Name cannot exceed ${MAX_NAME_LENGTH} characters`)
  .describe('Name (1-255 characters)');

/**
 * Notes/description field (max 1000 characters)
 * Used for: transactions, categories, accounts, rules
 */
export const notesSchema = z
  .string()
  .max(MAX_NOTES_LENGTH, `Notes cannot exceed ${MAX_NOTES_LENGTH} characters`)
  .optional()
  .describe('Optional notes (max 1000 characters)');

// ============================================================================
// STATUS FLAGS
// ============================================================================

/**
 * Transaction cleared flag
 * Indicates whether a transaction has cleared the bank
 */
export const clearedSchema = z
  .boolean()
  .optional()
  .describe('Whether the transaction has cleared');

/**
 * Transaction reconciled flag
 * Indicates whether a transaction has been reconciled
 */
export const reconciledSchema = z
  .boolean()
  .optional()
  .describe('Whether the transaction has been reconciled');

/**
 * Account closed flag
 * Indicates whether an account is closed
 */
export const closedSchema = z
  .boolean()
  .optional()
  .describe('Whether the account is closed');

/**
 * Account off-budget flag
 * Indicates whether an account is excluded from budget calculations
 */
export const offBudgetSchema = z
  .boolean()
  .optional()
  .describe('Whether the account is off-budget');

// ============================================================================
// SPLIT (SUBTRANSACTION) SCHEMAS (#305)
// ============================================================================

/**
 * A single split child. Only `amount` is required; `category` and `notes` are
 * optional. Child `account`/`date`/`cleared`/`reconciled` are ALWAYS derived
 * from the parent by @actual-app/api's `makeChild` (26.7.0), and `payee_name`
 * is not resolved on children, so extra fields are rejected here (`.strict()`)
 * to keep the contract honest rather than silently ignored.
 */
export const subtransactionSchema = z
  .object({
    amount: amountCentsSchema,
    category: categoryIdSchema.optional(),
    notes: notesSchema,
  })
  .strict();

/**
 * The `subtransactions` array on a split. Bounded per the project convention of
 * bounding every array input (cf. transactions_update_batch, entities_search
 * `.max(100)`, transactions_uncategorized `.max(1000)`).
 */
export const subtransactionsArraySchema = z
  .array(subtransactionSchema)
  .min(1, 'A split needs at least one subtransaction')
  .max(100, 'A split cannot exceed 100 subtransactions')
  .describe('Split children; each amount is integer cents and they must sum to the parent amount');

/**
 * Pure sum helper: the single source of CALCULATION for the split amount
 * invariant (#305). Enforced at two sites (create tool at the Zod layer where
 * the parent amount is in the input; update adapter against
 * `fields.amount ?? dbAmount`) so the arithmetic cannot drift between them.
 */
export function subtransactionsSum(subs: ReadonlyArray<{ amount: number }>): number {
  return subs.reduce((total, s) => total + s.amount, 0);
}

// ============================================================================
// COMPOSITE SCHEMAS
// ============================================================================

/**
 * Common schemas object for easy import
 * Usage: import { CommonSchemas } from '../lib/schemas/common.js';
 */
export const CommonSchemas = {
  // IDs
  accountId: accountIdSchema,
  transactionId: transactionIdSchema,
  categoryId: categoryIdSchema,
  categoryGroupId: categoryGroupIdSchema,
  payeeId: payeeIdSchema,
  ruleId: ruleIdSchema,
  accountGroupId: accountGroupIdSchema,
  tagId: tagIdSchema,
  tagName: tagNameSchema,
  tagColor: tagColorSchema,
  scheduleId: scheduleIdSchema,

  // Dates
  date: dateSchema,
  monthYear: monthYearSchema,
  
  // Amounts
  amountCents: amountCentsSchema,
  budgetAmountCents: budgetAmountCentsSchema,
  optionalAmountCents: optionalAmountCentsSchema,
  
  // Text fields
  name: nameSchema,
  notes: notesSchema,
  
  // Status flags
  cleared: clearedSchema,
  reconciled: reconciledSchema,
  closed: closedSchema,
  offBudget: offBudgetSchema,

  // Splits (#305)
  subtransaction: subtransactionSchema,
  subtransactions: subtransactionsArraySchema,
} as const;

// ============================================================================
// EXAMPLES
// ============================================================================

/**
 * Example usage in tool definitions:
 * 
 * ```typescript
 * import { z } from 'zod';
 * import { CommonSchemas } from '../lib/schemas/common.js';
 * 
 * const InputSchema = z.object({
 *   accountId: CommonSchemas.accountId,
 *   name: CommonSchemas.name,
 *   balance: CommonSchemas.optionalAmountCents,
 * });
 * ```
 */

/**
 * The keys an import row may carry (#749): the nine documented ones, `account` (upstream overwrites
 * it with the target account id), and the three pass-through keys (#217). The legacy
 * actual_transactions_import row schema and the compact manage_transactions import check both
 * close on this one list, so a typo or an internal column is refused by name before any adapter call.
 */
export const TX_IMPORT_ROW_KEYS = [
  'date',
  'amount',
  'payee',
  'payee_name',
  'imported_payee',
  'category',
  'notes',
  'cleared',
  'imported_id',
  'account',
  'subtransactions',
  'transfer_id',
  'reconciled',
] as const;

/**
 * The keys of a transaction that are NOT NULL upstream (#814). Create requires them; update and
 * update_batch accept a new value or no key at all, never null: upstream's conform() throws
 * `"amount" is required for table "transactions"` with the row JSON. The compact update check and
 * the unit tests iterate this one list.
 */
export const TX_UPDATE_NOT_NULL_KEYS = ['account', 'date', 'amount'] as const;

/** The refusal for an update that changes nothing (#815). One text for the compact and legacy tools. */
export const TX_UPDATE_NEEDS_A_FIELD = 'update needs at least one field to change besides id';

/**
 * True when some key other than `except` holds a value that is not undefined (#815). A key set to
 * null counts as a change (null clears payee, category and notes); an undefined-only object does
 * not. Pass `except = ''` for a `fields` object, which has no id.
 */
export const hasFieldToChange = (v: Record<string, unknown>, except = 'id'): boolean =>
  Object.entries(v).some(([key, val]) => key !== except && val !== undefined);

/**
 * The keys a split child in an import row may carry (#749). Upstream's makeChild spreads the child
 * over a default (so `amount` defaults to 0) and reads `category` and `payee` from it; `notes` is a
 * column. Any other key reaches the database layer and throws `Field "x" does not exist`, so the
 * legacy child schema and the compact import check close on this one list.
 */
export const TX_IMPORT_CHILD_KEYS = ['amount', 'category', 'notes', 'payee'] as const;
