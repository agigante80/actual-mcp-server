import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * summarize_transactions (#673): the compact front for the six totals and balance reports.
 * Selector `report` is required. Every report is read-only. Nothing here imports the adapter:
 * the dispatcher reaches Actual only through callOperation (#671).
 *
 * Mapping (#670 section 7): by_category -> actual_transactions_summary_by_category,
 * by_payee -> actual_transactions_summary_by_payee, grouped -> actual_transactions_aggregate,
 * account_flow -> actual_account_flow_summary, recurring -> actual_recurring_expenses_summary,
 * balance -> actual_accounts_get_balance (account_id is sent as `id`).
 *
 * Each schema is built ONCE and shared by every report that uses it, so the flat published
 * schema keeps the key typed. A key that one report requires and another leaves optional
 * would not share one object, so requiredness is enforced by `guard` instead, with the same
 * "required for report: X" wording the dispatcher uses. No schema carries a default: legacy
 * defaults are applied by the legacy tool.
 */

const startDate = CommonSchemas.date.describe('First day, inclusive. Required for grouped and account_flow.').optional();
const endDate = CommonSchemas.date.describe('Last day, inclusive. Required for grouped and account_flow.').optional();
const accountId = z.string().min(1).describe('Account id from list_entities. Required for balance.').optional();
const accountIds = z.array(z.string().min(1)).min(1).max(100).describe('Account ids from list_entities. Required for account_flow.').optional();
const includeIncome = z.boolean().describe('true also counts income (default false).').optional();
const limit = z.number().int().min(1).describe('Maximum payees (default 50).').optional();
const groupBy = z
  .union([
    z.enum(['month', 'category', 'category_group', 'payee', 'account']),
    z.array(z.enum(['month', 'category', 'category_group', 'payee', 'account'])).min(1).max(5),
  ])
  .describe('One grouping, or an array of up to 5. Required for grouped.')
  .optional();
const categoryIds = z.array(z.string().min(1)).min(1).max(100).describe('Only these category ids.').optional();
const categoryGroupIds = z.array(z.string().min(1)).min(1).max(100).describe('Only these category group ids.').optional();
const payeeIds = z.array(z.string().min(1)).min(1).max(100).describe('Only these payee ids.').optional();
const excludeTransfers = z.boolean().describe('false keeps transfers (default true).').optional();
const months = z.number().int().min(1).max(60).describe('Look back this many months, instead of start_date.').optional();
const minOccurrences = z.number().int().min(2).max(100).describe('Fewest occurrences to count (default 3).').optional();
const includeInactive = z.boolean().describe('true also lists series that have stopped (default false).').optional();
const cutoff = CommonSchemas.date.describe('Balance as of this day (default now).').optional();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Rules {
  required?: readonly string[];
  dateOrder?: boolean;
  exclusiveMonths?: boolean;
  uuidAccount?: boolean;
}

/** Cross-field rules the shared optional schemas cannot express. */
const guard = <T extends z.ZodObject>(fields: T, report: string, rules: Rules): T =>
  fields.superRefine((value, ctx) => {
    const v = value as Record<string, unknown>;
    const add = (key: string, message: string): void => { ctx.addIssue({ code: 'custom', path: [key], message }); };
    for (const key of rules.required ?? []) if (v[key] === undefined) add(key, `required for report: ${report}`);
    if (rules.dateOrder && typeof v.start_date === 'string' && typeof v.end_date === 'string' && v.end_date < v.start_date) {
      add('end_date', `must not be before start_date for report: ${report}`);
    }
    if (rules.exclusiveMonths && v.months !== undefined && v.start_date !== undefined) {
      add('months', 'use start_date or months, not both, for report: recurring');
    }
    if (rules.uuidAccount && typeof v.account_id === 'string' && !UUID.test(v.account_id)) {
      add('account_id', 'must be an account id (a UUID) from list_entities with type account, not a name');
    }
  }) as T;

/** Compact snake_case key to the legacy camelCase key. */
const camel = (keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())]));

const row = (legacy: string, shape: Record<string, z.ZodType>, report: string, rules: Rules = {}): CompactActionRow => ({
  legacy,
  fields: guard(z.object(shape), report, rules),
  rename: camel(Object.keys(shape)),
});

export const summarizeTransactions: CompactToolSpec = {
  name: 'summarize_transactions',
  description:
    'Totals, not records: spending sums, grouped breakdowns, recurring expenses and account balance; pick one `report`. Read-only. ' +
    'For individual transactions use search_transactions; for ids use list_entities; for budgeted versus spent use list_budget_months; for a custom query use run_query. ' +
    'One the chosen `report` does not take is refused by name. Amounts are integer cents, outflows negative; dates YYYY-MM-DD. ' +
    'by_category: start_date, end_date, account_id, include_income. ' +
    'by_payee: start_date, end_date, account_id, limit. ' +
    'grouped: requires start_date, end_date, group_by; optional account_ids, category_ids, category_group_ids, payee_ids, include_income, exclude_transfers. ' +
    'account_flow: requires start_date, end_date, account_ids. ' +
    'recurring: start_date or months, account_ids, min_occurrences, include_inactive. ' +
    'balance: requires account_id; optional cutoff date. ' +
    'Returns { summary: [{ categoryGroup, categoryName, totalAmount, transactionCount }], totalAmount, dateRange } for by_category; the same with payeeName for by_payee; ' +
    'aggregated groups with totals for grouped and account_flow; repeating payees for recurring; { balance, accountName } in cents for balance.',
  selector: 'report',
  actions: new Map<string, CompactActionRow>([
    ['by_category', row('actual_transactions_summary_by_category', { start_date: startDate, end_date: endDate, account_id: accountId, include_income: includeIncome }, 'by_category')],
    ['by_payee', row('actual_transactions_summary_by_payee', { start_date: startDate, end_date: endDate, account_id: accountId, limit }, 'by_payee')],
    ['grouped', row('actual_transactions_aggregate', {
      start_date: startDate,
      end_date: endDate,
      group_by: groupBy,
      account_ids: accountIds,
      category_ids: categoryIds,
      category_group_ids: categoryGroupIds,
      payee_ids: payeeIds,
      include_income: includeIncome,
      exclude_transfers: excludeTransfers,
    }, 'grouped', { required: ['start_date', 'end_date', 'group_by'], dateOrder: true })],
    ['account_flow', row('actual_account_flow_summary', { start_date: startDate, end_date: endDate, account_ids: accountIds }, 'account_flow', {
      required: ['start_date', 'end_date', 'account_ids'],
      dateOrder: true,
    })],
    ['recurring', row('actual_recurring_expenses_summary', {
      start_date: startDate,
      end_date: endDate,
      months,
      account_ids: accountIds,
      min_occurrences: minOccurrences,
      include_inactive: includeInactive,
    }, 'recurring', { dateOrder: true, exclusiveMonths: true })],
    ['balance', { ...row('actual_accounts_get_balance', { account_id: accountId, cutoff }, 'balance', { required: ['account_id'], uuidAccount: true }), rename: { account_id: 'id' } }],
  ]),
};
