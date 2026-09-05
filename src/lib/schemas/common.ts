/**
 * Shared Zod Validation Schemas
 * 
 * Common validation schemas used across MCP tools for Actual Budget.
 * These schemas provide consistent validation, better error messages,
 * and reduce duplication across the 77 tool definitions.
 */

import { z } from 'zod';
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
export const tagIdSchema = z
  .string()
  .regex(UUID_PATTERN, 'Invalid tag ID format (expected UUID)')
  .describe('Tag UUID');

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
 * Date in YYYY-MM-DD format
 * Used for: transactions, account balance queries, date range filters
 * Example: "2025-11-24"
 */
export const dateSchema = z
  .string()
  .regex(DATE_PATTERN, 'Invalid date format (expected YYYY-MM-DD)')
  .describe('Date in YYYY-MM-DD format');

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
  tagId: tagIdSchema,
  scheduleId: scheduleIdSchema,

  // Dates
  date: dateSchema,
  monthYear: monthYearSchema,
  
  // Amounts
  amountCents: amountCentsSchema,
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
