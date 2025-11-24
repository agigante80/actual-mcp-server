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
  setBudgetCarryover as rawSetBudgetCarryover,
  closeAccount as rawCloseAccount,
  reopenAccount as rawReopenAccount,
  getCategoryGroups as rawGetCategoryGroups,
  createCategoryGroup as rawCreateCategoryGroup,
  updateCategoryGroup as rawUpdateCategoryGroup,
  deleteCategoryGroup as rawDeleteCategoryGroup,
  mergePayees as rawMergePayees,
  getPayeeRules as rawGetPayeeRules,
  batchBudgetUpdates as rawBatchBudgetUpdates,
  holdBudgetForNextMonth as rawHoldBudgetForNextMonth,
  resetBudgetHold as rawResetBudgetHold,
  runQuery as rawRunQuery,
  runBankSync as rawRunBankSync,
  getBudgets as rawGetBudgets,
} from '@actual-app/api/dist/methods.js';
import api from '@actual-app/api';
import { EventEmitter } from 'events';
import observability from '../observability.js';
import retry from './retry.js';
import logger from '../logger.js';

/**
 * Helper to init and shutdown Actual API around each operation
 * This is CRITICAL for data persistence - shutdown() must be called after every operation
 * Based on the pattern from https://github.com/s-stefanov/actual-mcp
 */
async function withActualApi<T>(operation: () => Promise<T>): Promise<T> {
  try {
    // Initialize API for this operation
    await initActualApiForOperation();
    
    // Execute the operation
    return await operation();
  } finally {
    // CRITICAL: Always call shutdown after operation
    // This ensures data is properly committed and tombstone=0
    await shutdownActualApi();
  }
}

/**
 * Initialize Actual API - based on s-stefanov/actual-mcp pattern
 * This calls api.init() and api.downloadBudget() for each operation
 */
async function initActualApiForOperation(): Promise<void> {
  try {
    const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
    const PASSWORD = process.env.ACTUAL_PASSWORD;
    const BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID;
    const BUDGET_PASSWORD = process.env.ACTUAL_BUDGET_PASSWORD;
    const DATA_DIR = process.env.MCP_BRIDGE_DATA_DIR || './test-actual-data';

    logger.debug('[ADAPTER] Initializing Actual API for operation');
    
    await api.init({
      dataDir: DATA_DIR,
      serverURL: SERVER_URL,
      password: PASSWORD || '',
    });

    logger.debug('[ADAPTER] Downloading budget');
    
    if (BUDGET_PASSWORD) {
      const apiWithOptions = api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> };
      await apiWithOptions.downloadBudget(BUDGET_SYNC_ID!, { password: BUDGET_PASSWORD });
    } else {
      await api.downloadBudget(BUDGET_SYNC_ID!);
    }
    
    logger.debug('[ADAPTER] Actual API initialized for operation');
  } catch (err) {
    logger.error('[ADAPTER] Error initializing Actual API:', err);
    throw err;
  }
}

async function shutdownActualApi(): Promise<void> {
  try {
    const maybeApi = api as unknown as { shutdown?: Function };
    if (typeof maybeApi.shutdown === 'function') {
      await (maybeApi.shutdown as () => Promise<unknown>)();
      logger.debug('[ADAPTER] Actual API shutdown complete');
    }
  } catch (err) {
    logger.error('[ADAPTER] Error during Actual API shutdown:', err);
  }
}

import { DEFAULT_CONCURRENCY_LIMIT } from './constants.js';

/**
 * Very small concurrency limiter for adapter calls. This prevents bursts from
 * overloading the actual server. It's intentionally tiny and in-memory; replace
 * with Bottleneck or p-queue for production.
 */
let MAX_CONCURRENCY = parseInt(process.env.ACTUAL_API_CONCURRENCY || String(DEFAULT_CONCURRENCY_LIMIT), 10);
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

/**
 * Sync local changes to the Actual Budget server.
 * 
 * This function should be called after write operations (create, update, delete)
 * to ensure changes are properly synced to the remote server. Without syncing,
 * changes may only exist locally and could be lost.
 * 
 * Note: Adds a small delay to ensure local changes are committed before syncing.
 */
async function syncToServer(): Promise<void> {
  try {
    // Small delay to ensure local changes are committed to the database
    // before attempting to sync to the server
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // TypeScript doesn't recognize sync in the type definitions, but it exists at runtime
    console.log('[SYNC] Calling api.sync()...');
    await (api as any).sync();
    console.log('[SYNC] api.sync() completed successfully');
  } catch (err) {
    // Log but don't throw - sync failures shouldn't break the operation
    console.error('[SYNC] Sync to server failed:', err);
  }
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
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.list').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetAccounts() as Promise<components['schemas']['Account'][]>, { retries: 2, backoffMs: 200 }));
  });
}
// addTransactions returns various formats: "ok", array of IDs, or Transaction objects
export async function addTransactions(txs: components['schemas']['TransactionInput'][] | components['schemas']['TransactionInput']) : Promise<string[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.transactions.create').catch(() => {});
    
    // The Actual API expects addTransactions(accountId, transactions, options)
    // Extract accountId from the first transaction and remove it from transaction objects
    const txArray = Array.isArray(txs) ? txs : [txs];
    if (txArray.length === 0) {
      throw new Error('No transactions provided');
    }
    
    const accountId = (txArray[0] as any).account || (txArray[0] as any).accountId;
    if (!accountId) {
      throw new Error('Transaction must include account or accountId');
    }
    
    // Remove account/accountId from transaction objects as they're passed separately
    const cleanedTxs = txArray.map(tx => {
      const { account, accountId: _, ...rest } = tx as any;
      return rest;
    });
    
    // API docs say it returns id[], but reality is it can return "ok", array of IDs, or Transaction objects
    const result = await withConcurrency(() => retry(() => rawAddTransactions(accountId, cleanedTxs, {}) as Promise<unknown>, { retries: 2, backoffMs: 200 }));
    
    // Handle various return formats
    if (result === 'ok') {
      // Transaction created successfully but no IDs returned
      // We'll need to query the account to get the transaction IDs
      return ['ok'];  // Return success indicator
    } else if (Array.isArray(result)) {
      // Could be array of IDs (strings) or array of Transaction objects
      if (result.length === 0) return [];
      if (typeof result[0] === 'string') return result as string[];
      if (typeof result[0] === 'object' && result[0] !== null && 'id' in result[0]) {
        return result.map((t: any) => t.id);
      }
    } else if (typeof result === 'object' && result !== null && 'id' in (result as any)) {
      // Single Transaction object
      return [(result as any).id];
    }
    
    return [];
  });
}
export async function importTransactions(accountId: string | undefined, txs: components['schemas']['TransactionInput'][] | unknown) : Promise<{ added?: string[]; updated?: string[]; errors?: string[] }>{
  return withActualApi(async () => {
    observability.incrementToolCall('actual.transactions.import').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawImportTransactions(accountId, txs) as Promise<{ added?: string[]; updated?: string[]; errors?: string[] }>, { retries: 2, backoffMs: 200 }));
    return raw || { added: [], updated: [], errors: [] };
  });
}
export async function getTransactions(accountId: string | undefined, startDate?: string, endDate?: string): Promise<components['schemas']['Transaction'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.transactions.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetTransactions(accountId, startDate, endDate) as Promise<components['schemas']['Transaction'][]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getCategories(): Promise<components['schemas']['Category'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.categories.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetCategories() as Promise<components['schemas']['Category'][]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function createCategory(category: components['schemas']['Category'] | unknown): Promise<string> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.categories.create').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawCreateCategory(category) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function getPayees(): Promise<components['schemas']['Payee'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetPayees() as Promise<components['schemas']['Payee'][]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function createPayee(payee: components['schemas']['Payee'] | unknown): Promise<string> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.create').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawCreatePayee(payee) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function getBudgetMonths(): Promise<string[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.getMonths').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetBudgetMonths() as Promise<string[]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getBudgetMonth(month: string | undefined): Promise<components['schemas']['BudgetMonth']> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.getMonth').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetBudgetMonth(month) as Promise<components['schemas']['BudgetMonth']>, { retries: 2, backoffMs: 200 }));
  });
}
export async function setBudgetAmount(month: string | undefined, categoryId: string | undefined, amount: number | undefined): Promise<components['schemas']['BudgetSetRequest'] | null | void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.setAmount').catch(() => {});
    const result = await withConcurrency(() => retry(() => rawSetBudgetAmount(month, categoryId, amount) as Promise<components['schemas']['BudgetSetRequest'] | null | void>, { retries: 2, backoffMs: 200 }));
    return result;
  });
}
export async function createAccount(account: components['schemas']['Account'] | unknown, initialBalance?: number): Promise<string> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.create').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawCreateAccount(account, initialBalance) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
    const id = normalizeToId(raw);
    // NO NEED for syncToServer() - shutdown() will handle persistence
    return id;
  });
}
export async function updateAccount(id: string, fields: Partial<components['schemas']['Account']> | unknown): Promise<void | null> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.update').catch(() => {});
    await withConcurrency(() => retry(() => rawUpdateAccount(id, fields) as Promise<void | null>, { retries: 2, backoffMs: 200 }));
    return null;
  });
}
export async function getAccountBalance(id: string, cutoff?: string): Promise<number> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.get.balance').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetAccountBalance(id, cutoff) as Promise<number>, { retries: 2, backoffMs: 200 }));
  });
}
export async function deleteAccount(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.delete').catch(() => {});
    await withConcurrency(() => retry(() => rawDeleteAccount(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function updateTransaction(id: string, fields: Partial<components['schemas']['Transaction']> | unknown): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.transactions.update').catch(() => {});
    await withConcurrency(() => retry(() => rawUpdateTransaction(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function deleteTransaction(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.transactions.delete').catch(() => {});
    await withConcurrency(() => retry(() => rawDeleteTransaction(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function updateCategory(id: string, fields: Partial<components['schemas']['Category']> | unknown): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.categories.update').catch(() => {});
    await withConcurrency(() => retry(() => rawUpdateCategory(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function deleteCategory(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.categories.delete').catch(() => {});
    await withConcurrency(() => retry(() => rawDeleteCategory(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function updatePayee(id: string, fields: Partial<components['schemas']['Payee']> | unknown): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.update').catch(() => {});
    await withConcurrency(() => retry(() => rawUpdatePayee(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function deletePayee(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.delete').catch(() => {});
    await withConcurrency(() => retry(() => rawDeletePayee(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getRules(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.rules.get').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetRules() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}
export async function createRule(rule: unknown): Promise<string> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.rules.create').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawCreateRule(rule) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function updateRule(id: string, fields: unknown): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.rules.update').catch(() => {});
    // The Actual Budget API expects the full rule object with id, not separate id and fields
    const rule = { id, ...(fields as object) };
    await withConcurrency(() => retry(() => rawUpdateRule(rule) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function deleteRule(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.rules.delete').catch(() => {});
    await withConcurrency(() => retry(() => rawDeleteRule(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.setCarryover').catch(() => {});
    await withConcurrency(() => retry(() => rawSetBudgetCarryover(month, categoryId, flag) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function closeAccount(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.close').catch(() => {});
    await withConcurrency(() => retry(() => rawCloseAccount(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function reopenAccount(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.reopen').catch(() => {});
    await withConcurrency(() => retry(() => rawReopenAccount(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getCategoryGroups(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.category_groups.get').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetCategoryGroups() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}
export async function createCategoryGroup(group: unknown): Promise<string> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.category_groups.create').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawCreateCategoryGroup(group) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200 }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function updateCategoryGroup(id: string, fields: unknown): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.category_groups.update').catch(() => {});
    await withConcurrency(() => retry(() => rawUpdateCategoryGroup(id, fields) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function deleteCategoryGroup(id: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.category_groups.delete').catch(() => {});
    await withConcurrency(() => retry(() => rawDeleteCategoryGroup(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.merge').catch(() => {});
    await withConcurrency(() => retry(() => rawMergePayees(targetId, mergeIds) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getPayeeRules(payeeId: string): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.getPayeeRules').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetPayeeRules(payeeId) as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}
export async function batchBudgetUpdates(fn: () => Promise<void>): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.batchUpdates').catch(() => {});
    await withConcurrency(() => retry(() => rawBatchBudgetUpdates(fn) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function holdBudgetForNextMonth(month: string, categoryId: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.holdForNextMonth').catch(() => {});
    await withConcurrency(() => retry(() => rawHoldBudgetForNextMonth(month, categoryId) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function resetBudgetHold(month: string, categoryId: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.resetHold').catch(() => {});
    await withConcurrency(() => retry(() => rawResetBudgetHold(month, categoryId) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function runQuery(queryString: string): Promise<unknown> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.query.run').catch(() => {});
    // The Actual Budget runQuery expects an ActualQL query object with serialize() method
    // Import the q builder dynamically
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    if (!q) {
      throw new Error('ActualQL query builder not available');
    }
    
    // Simple parser: if it's just a table name, query that table
    // If it contains spaces or SQL keywords, try to parse it
    const trimmed = queryString.trim();
    let query;
    
    // Very basic SQL-like parsing: "SELECT * FROM tablename LIMIT n"
    const selectMatch = trimmed.match(/^SELECT\s+\*\s+FROM\s+(\w+)(?:\s+LIMIT\s+(\d+))?/i);
    if (selectMatch) {
      const tableName = selectMatch[1];
      const limit = selectMatch[2] ? parseInt(selectMatch[2]) : undefined;
      query = q(tableName);
      if (limit) {
        query = query.limit(limit);
      }
    } else {
      // Assume it's just a table name
      query = q(trimmed);
    }
    
    return await withConcurrency(() => retry(() => rawRunQuery(query) as Promise<unknown>, { retries: 2, backoffMs: 200 }));
  });
}
export async function runBankSync(accountId?: string): Promise<void> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.bank.sync').catch(() => {});
    await withConcurrency(() => retry(() => rawRunBankSync(accountId ? { accountId } : undefined) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getBudgets(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.getAll').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetBudgets() as Promise<unknown>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
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
  setBudgetCarryover,
  closeAccount,
  reopenAccount,
  getCategoryGroups,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  mergePayees,
  getPayeeRules,
  batchBudgetUpdates,
  holdBudgetForNextMonth,
  resetBudgetHold,
  runQuery,
  runBankSync,
  getBudgets,
  notifications,
};
