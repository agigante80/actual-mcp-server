import type { components } from '../../generated/actual-client/types.js';

import {
  addTransactions as rawAddTransactions,
  getAccounts as rawGetAccounts,
  importTransactions as rawImportTransactions,
  getTransactions as rawGetTransactions,
  getCategories as rawGetCategories,
  createCategory as rawCreateCategory,
  getPayees as rawGetPayees,
  createPayee as rawCreatePayee,
  getBudgetMonths as rawGetBudgetMonths,
  getBudgetMonth as rawGetBudgetMonth,
  setBudgetAmount as rawSetBudgetAmount,
  createAccount as rawCreateAccount,
  updateAccount as rawUpdateAccount,
  getAccountBalance as rawGetAccountBalance,
  updateTransaction as rawUpdateTransaction,
  deleteTransaction as rawDeleteTransaction,
  updateCategory as rawUpdateCategory,
  deleteCategory as rawDeleteCategory,
  updatePayee as rawUpdatePayee,
  deletePayee as rawDeletePayee,
  deleteAccount as rawDeleteAccount,
  getRules as rawGetRules,
  createRule as rawCreateRule,
  updateRule as rawUpdateRule,
  deleteRule as rawDeleteRule,
} from '@actual-app/api/dist/methods.js';
import { EventEmitter } from 'events';
import observability from '../observability.js';
import retry from './retry.js';

/**
 * Very small concurrency limiter for adapter calls. This prevents bursts from
 * overloading the actual server. It's intentionally tiny and in-memory; replace
 * with Bottleneck or p-queue for production.
 */
let MAX_CONCURRENCY = parseInt(process.env.ACTUAL_API_CONCURRENCY || '6', 10);
let running = 0;
const queue: Array<() => void> = [];

function processQueue() {
  if (running >= MAX_CONCURRENCY) return;
  const next = queue.shift();
  if (!next) return;
  running++;
  try {
    next();
  } catch (e) {
    // next() will manage its own promise resolution
    running--;
    processQueue();
  }
}

function withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENCY) {
    running++;
    return fn().finally(() => {
      running--;
      processQueue();
    });
  }
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const r = await fn();
        resolve(r);
      } catch (err) {
        reject(err);
      } finally {
        running--;
        processQueue();
      }
    });
  });
}

// Expose some helpers for testing concurrency
export function getConcurrencyState() {
  return { running, queueLength: queue.length, maxConcurrency: MAX_CONCURRENCY };
}

export function setMaxConcurrency(n: number) {
  MAX_CONCURRENCY = n;
}

/**
 * Wrap a raw function with the standard adapter retry + concurrency behavior.
 * Useful for tests that want to exercise retry behavior without calling the real raw methods.
 */
export function callWithRetry<T>(fn: () => Promise<T>, opts?: { retries?: number; backoffMs?: number }): Promise<T> {
  // retry already types the options; forward them directly and let TypeScript
  // validate shapes rather than using `as any`.
  return withConcurrency(() => retry(fn, opts));
}

export const notifications = new EventEmitter();

// --- Normalization helpers -------------------------------------------------
export function normalizeToTransactionArray(raw: unknown): components['schemas']['Transaction'][] {
  if (!raw) return [];
  // If already an array of transactions
  if (Array.isArray(raw) && (raw as unknown[]).every(r => typeof r === 'object')) return raw as components['schemas']['Transaction'][];
  // If a single transaction object, wrap it
  if (typeof raw === 'object' && raw !== null && 'id' in (raw as Record<string, unknown>)) return [raw as components['schemas']['Transaction']];
  // If array of ids returned, convert to minimal Transaction objects
  if (Array.isArray(raw) && (raw as unknown[]).every(r => typeof r === 'string')) {
    return (raw as string[]).map(id => ({ id } as components['schemas']['Transaction']));
  }
  // Fallback: try to coerce
  return Array.isArray(raw) ? (raw as components['schemas']['Transaction'][]) : [];
}

export function normalizeToId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'id' in (raw as Record<string, unknown>)) {
    const idVal = (raw as Record<string, unknown>)['id'];
    if (typeof idVal === 'string') return idVal;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0] as string;
  return String(raw ?? '');
}

export function normalizeImportResult(raw: unknown): { added?: string[]; updated?: string[]; errors?: string[] } {
  if (!raw || typeof raw !== 'object') return { added: [], updated: [], errors: [] };
  const r = raw as Record<string, unknown>;
  return {
    added: Array.isArray(r.added) ? (r.added as string[]) : [],
    updated: Array.isArray(r.updated) ? (r.updated as string[]) : [],
    errors: Array.isArray(r.errors) ? (r.errors as string[]) : [],
  };
}
// ---------------------------------------------------------------------------

export async function getAccounts(): Promise<components['schemas']['Account'][]> {
  observability.incrementToolCall('actual.accounts.list').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetAccounts() as Promise<components['schemas']['Account'][]>, { retries: 2, backoffMs: 200 }));
}
type RawAddTransactionsResult = components['schemas']['Transaction'] | components['schemas']['Transaction'][] | string[];
export async function addTransactions(txs: components['schemas']['TransactionInput'][] | components['schemas']['TransactionInput']) : Promise<components['schemas']['Transaction'][]> {
  observability.incrementToolCall('actual.transactions.create').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawAddTransactions(txs) as Promise<RawAddTransactionsResult>, { retries: 2, backoffMs: 200 }));
  return normalizeToTransactionArray(raw);
}
export async function importTransactions(accountId: string | undefined, txs: components['schemas']['TransactionInput'][] | unknown) : Promise<{ added?: string[]; updated?: string[]; errors?: string[] }>{
  observability.incrementToolCall('actual.transactions.import').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawImportTransactions(accountId, txs) as Promise<{ added?: string[]; updated?: string[]; errors?: string[] }>, { retries: 2, backoffMs: 200 }));
  return normalizeImportResult(raw);
}
export async function getTransactions(accountId: string | undefined, startDate?: string, endDate?: string): Promise<components['schemas']['Transaction'][]> {
  observability.incrementToolCall('actual.transactions.get').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetTransactions(accountId, startDate, endDate) as Promise<components['schemas']['Transaction'][]>, { retries: 2, backoffMs: 200 }));
}
export async function getCategories(): Promise<components['schemas']['Category'][]> {
  observability.incrementToolCall('actual.categories.get').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetCategories() as Promise<components['schemas']['Category'][]>, { retries: 2, backoffMs: 200 }));
}
export async function createCategory(category: components['schemas']['Category'] | unknown): Promise<string> {
  observability.incrementToolCall('actual.categories.create').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawCreateCategory(category) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
  return normalizeToId(raw);
}
export async function getPayees(): Promise<components['schemas']['Payee'][]> {
  observability.incrementToolCall('actual.payees.get').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetPayees() as Promise<components['schemas']['Payee'][]>, { retries: 2, backoffMs: 200 }));
}
export async function createPayee(payee: components['schemas']['Payee'] | unknown): Promise<string> {
  observability.incrementToolCall('actual.payees.create').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawCreatePayee(payee) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
  return normalizeToId(raw);
}
export async function getBudgetMonths(): Promise<string[]> {
  observability.incrementToolCall('actual.budgets.getMonths').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetBudgetMonths() as Promise<string[]>, { retries: 2, backoffMs: 200 }));
}
export async function getBudgetMonth(month: string | undefined): Promise<components['schemas']['BudgetMonth']> {
  observability.incrementToolCall('actual.budgets.getMonth').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetBudgetMonth(month) as Promise<components['schemas']['BudgetMonth']>, { retries: 2, backoffMs: 200 }));
}
export async function setBudgetAmount(month: string | undefined, categoryId: string | undefined, amount: number | undefined): Promise<components['schemas']['BudgetSetRequest'] | null | void> {
  observability.incrementToolCall('actual.budgets.setAmount').catch(() => {});
  return await withConcurrency(() => retry(() => rawSetBudgetAmount(month, categoryId, amount) as Promise<components['schemas']['BudgetSetRequest'] | null | void>, { retries: 2, backoffMs: 200 }));
}
export async function createAccount(account: components['schemas']['Account'] | unknown, initialBalance?: number): Promise<string> {
  observability.incrementToolCall('actual.accounts.create').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawCreateAccount(account, initialBalance) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
  return normalizeToId(raw);
}
export async function updateAccount(id: string, fields: Partial<components['schemas']['Account']> | unknown): Promise<void | null> {
  observability.incrementToolCall('actual.accounts.update').catch(() => {});
  await withConcurrency(() => retry(() => rawUpdateAccount(id, fields) as Promise<void | null>, { retries: 2, backoffMs: 200 }));
  return null;
}
export async function getAccountBalance(id: string, cutoff?: string): Promise<number> {
  observability.incrementToolCall('actual.accounts.get.balance').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetAccountBalance(id, cutoff) as Promise<number>, { retries: 2, backoffMs: 200 }));
}
export async function deleteAccount(id: string): Promise<void> {
  observability.incrementToolCall('actual.accounts.delete').catch(() => {});
  await withConcurrency(() => retry(() => rawDeleteAccount(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function updateTransaction(id: string, fields: Partial<components['schemas']['Transaction']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.transactions.update').catch(() => {});
  await withConcurrency(() => retry(() => rawUpdateTransaction(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function deleteTransaction(id: string): Promise<void> {
  observability.incrementToolCall('actual.transactions.delete').catch(() => {});
  await withConcurrency(() => retry(() => rawDeleteTransaction(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function updateCategory(id: string, fields: Partial<components['schemas']['Category']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.categories.update').catch(() => {});
  await withConcurrency(() => retry(() => rawUpdateCategory(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function deleteCategory(id: string): Promise<void> {
  observability.incrementToolCall('actual.categories.delete').catch(() => {});
  await withConcurrency(() => retry(() => rawDeleteCategory(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function updatePayee(id: string, fields: Partial<components['schemas']['Payee']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.payees.update').catch(() => {});
  await withConcurrency(() => retry(() => rawUpdatePayee(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function deletePayee(id: string): Promise<void> {
  observability.incrementToolCall('actual.payees.delete').catch(() => {});
  await withConcurrency(() => retry(() => rawDeletePayee(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function getRules(): Promise<unknown[]> {
  observability.incrementToolCall('actual.rules.get').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawGetRules() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
  return Array.isArray(raw) ? raw : [];
}
export async function createRule(rule: unknown): Promise<string> {
  observability.incrementToolCall('actual.rules.create').catch(() => {});
  const raw = await withConcurrency(() => retry(() => rawCreateRule(rule) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
  return normalizeToId(raw);
}
export async function updateRule(id: string, fields: unknown): Promise<void> {
  observability.incrementToolCall('actual.rules.update').catch(() => {});
  await withConcurrency(() => retry(() => rawUpdateRule(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
}
export async function deleteRule(id: string): Promise<void> {
  observability.incrementToolCall('actual.rules.delete').catch(() => {});
  await withConcurrency(() => retry(() => rawDeleteRule(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
}

export default {
  getAccounts,
  addTransactions,
  importTransactions,
  getTransactions,
  getCategories,
  createCategory,
  getPayees,
  createPayee,
  getBudgetMonths,
  getBudgetMonth,
  setBudgetAmount,
  createAccount,
  updateAccount,
  getAccountBalance,
  deleteAccount,
  updateTransaction,
  deleteTransaction,
  updateCategory,
  deleteCategory,
  updatePayee,
  deletePayee,
  getRules,
  createRule,
  updateRule,
  deleteRule,
  notifications,
};
