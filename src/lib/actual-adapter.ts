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
} from '@actual-app/api/dist/methods.js';
import { EventEmitter } from 'events';
import observability from '../observability.js';
import retry from './retry.js';

/**
 * Very small concurrency limiter for adapter calls. This prevents bursts from
 * overloading the actual server. It's intentionally tiny and in-memory; replace
 * with Bottleneck or p-queue for production.
 */
const MAX_CONCURRENCY = parseInt(process.env.ACTUAL_API_CONCURRENCY || '6', 10);
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

export const notifications = new EventEmitter();

export async function getAccounts() {
  observability.incrementToolCall('actual.accounts.list').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetAccounts(), { retries: 2, backoffMs: 200 }));
}

export async function addTransactions(txs: any) {
  observability.incrementToolCall('actual.transactions.create').catch(() => {});
  return await withConcurrency(() => retry(() => rawAddTransactions(txs), { retries: 2, backoffMs: 200 }));
}

export async function importTransactions(accountId: string | undefined, txs: any) {
  observability.incrementToolCall('actual.transactions.import').catch(() => {});
  return await withConcurrency(() => retry(() => rawImportTransactions(accountId, txs), { retries: 2, backoffMs: 200 }));
}

export async function getTransactions(accountId: string | undefined, startDate?: string, endDate?: string) {
  observability.incrementToolCall('actual.transactions.get').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetTransactions(accountId, startDate, endDate), { retries: 2, backoffMs: 200 }));
}

export async function getCategories() {
  observability.incrementToolCall('actual.categories.get').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetCategories(), { retries: 2, backoffMs: 200 }));
}

export async function createCategory(category: any) {
  observability.incrementToolCall('actual.categories.create').catch(() => {});
  return await withConcurrency(() => retry(() => rawCreateCategory(category), { retries: 2, backoffMs: 200 }));
}

export async function getPayees() {
  observability.incrementToolCall('actual.payees.get').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetPayees(), { retries: 2, backoffMs: 200 }));
}

export async function createPayee(payee: any) {
  observability.incrementToolCall('actual.payees.create').catch(() => {});
  return await withConcurrency(() => retry(() => rawCreatePayee(payee), { retries: 2, backoffMs: 200 }));
}

export async function getBudgetMonths() {
  observability.incrementToolCall('actual.budgets.getMonths').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetBudgetMonths(), { retries: 2, backoffMs: 200 }));
}

export async function getBudgetMonth(month: string | undefined) {
  observability.incrementToolCall('actual.budgets.getMonth').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetBudgetMonth(month), { retries: 2, backoffMs: 200 }));
}

export async function setBudgetAmount(month: string | undefined, categoryId: string | undefined, amount: number | undefined) {
  observability.incrementToolCall('actual.budgets.setAmount').catch(() => {});
  return await withConcurrency(() => retry(() => rawSetBudgetAmount(month, categoryId, amount), { retries: 2, backoffMs: 200 }));
}

export async function createAccount(account: any, initialBalance?: number) {
  observability.incrementToolCall('actual.accounts.create').catch(() => {});
  return await withConcurrency(() => retry(() => rawCreateAccount(account, initialBalance), { retries: 2, backoffMs: 200 }));
}

export async function updateAccount(id: string, fields: any) {
  observability.incrementToolCall('actual.accounts.update').catch(() => {});
  return await withConcurrency(() => retry(() => rawUpdateAccount(id, fields), { retries: 2, backoffMs: 200 }));
}

export async function getAccountBalance(id?: string, cutoff?: string) {
  observability.incrementToolCall('actual.accounts.get.balance').catch(() => {});
  return await withConcurrency(() => retry(() => rawGetAccountBalance(id, cutoff), { retries: 2, backoffMs: 200 }));
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
  notifications,
};
