import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import { childNotesMatch, expandSplitsForSearch } from '../lib/split-search.js';
import { refuseOffBudgetAccount } from '../lib/search-account-guard.js';

const InputSchema = z.object({
  accountId: z.string().nullable().optional().describe('Filter by specific account ID'),
  startDate: CommonSchemas.date.nullable().optional().describe('Start date (YYYY-MM-DD format)'),
  endDate: CommonSchemas.date.nullable().optional().describe('End date (YYYY-MM-DD format)'),
  minAmount: z.number().nullable().optional().describe('Minimum transaction amount in cents (negative for expenses)'),
  maxAmount: z.number().nullable().optional().describe('Maximum transaction amount in cents'),
  categoryId: z.string().nullable().optional().describe('Filter by category ID'),
  payeeId: z.string().nullable().optional().describe('Filter by payee ID'),
  notes: z.string().nullable().optional().describe('Search in transaction notes (case-insensitive)'),
  cleared: z.boolean().nullable().optional().describe('Filter by cleared status'),
  reconciled: z.boolean().nullable().optional().describe('Filter by reconciled status'),
});


const tool: ToolDefinition = {
  name: 'actual_transactions_filter',
  description:
    'Find transactions matching every filter given (AND): account, category and payee ids (not names), a YYYY-MM-DD date range, an amount range in integer cents, a case-insensitive notes substring, cleared, reconciled. Without accountId all accounts are searched. With categoryId or notes, a split is matched by its children; rows carry parent_id. ' +
    'Read-only; off-budget accounts are excluded, and an off-budget accountId is refused; no row limit. A name where an id belongs is refused, naming the matching id if any. ' +
    'To search by payee or category name use actual_transactions_search_by_payee or actual_transactions_search_by_category; for totals use actual_transactions_aggregate. Returns { result: [transactions] }.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // Convert null to undefined for adapter (LibreChat sends null, adapter expects undefined)
    // #388: these three filters silently returned an EMPTY result set when given a NAME, which
    // is the worst of the three answers the surface used to give: a plausible-looking wrong
    // answer. No listing is read for a well-formed id, so a correct call costs what it did.
    if (input.accountId) await adapter.resolveFilterId('account', input.accountId);
    if (input.categoryId) await adapter.resolveFilterId('category', input.categoryId);
    if (input.payeeId) await adapter.resolveFilterId('payee', input.payeeId);

    // #756: the account listing is read before the fetch so an explicit off-budget account is
    // refused instead of answered with an empty result. No `verifyExists` above (an unknown
    // well-formed id keeps returning { result: [] }); an id absent from the listing passes the guard.
    const accounts = await adapter.getAccounts();
    refuseOffBudgetAccount(Array.isArray(accounts) ? accounts : [], input.accountId);

    const accountId = input.accountId ?? undefined;
    const startDate = input.startDate ?? undefined;
    const endDate = input.endDate ?? undefined;
    
    // Get base transactions
    const transactions = await adapter.getTransactions(accountId, startDate, endDate);
    
    if (!Array.isArray(transactions)) {
      return { result: [] };
    }
    
    // Exclude off-budget accounts (issue #81) — their transactions cannot have
    // categories set; any update is silently discarded by Actual Budget.
    const offBudgetIds = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray(accounts) ? accounts : [])
        .filter((acc: any) => acc?.offbudget === true)
        .map((acc: any) => acc.id as string)
    );

    // Apply filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let filtered = transactions.filter((t: any) => !offBudgetIds.has(t?.account));

    // #750: a split parent has a null category and the notes of the split as a whole, so with a
    // category or notes filter the split is replaced by its children before any filter runs.
    let parentNotes = new Map<string, string | null>();
    if (input.categoryId || input.notes) {
      const expanded = expandSplitsForSearch(filtered);
      filtered = expanded.rows;
      parentNotes = expanded.parentNotes;
    }
    
    // Filter by amount range
    if (input.minAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) >= input.minAmount!);
    }
    if (input.maxAmount !== undefined) {
      filtered = filtered.filter((t: any) => (t.amount || 0) <= input.maxAmount!);
    }
    
    // Filter by category
    if (input.categoryId) {
      filtered = filtered.filter((t: any) => t.category === input.categoryId);
    }
    
    // Filter by payee
    if (input.payeeId) {
      filtered = filtered.filter((t: any) => t.payee === input.payeeId);
    }
    
    // Filter by notes (case-insensitive search)
    if (input.notes) {
      const searchTerm = input.notes.toLowerCase();
      filtered = filtered.filter((t: any) => childNotesMatch(t, parentNotes, searchTerm));
    }
    
    // Filter by cleared status
    if (input.cleared !== undefined) {
      filtered = filtered.filter((t: any) => t.cleared === input.cleared);
    }
    
    // Filter by reconciled status
    if (input.reconciled !== undefined) {
      filtered = filtered.filter((t: any) => t.reconciled === input.reconciled);
    }
    
    return { result: filtered };
  },
};

export default tool;
