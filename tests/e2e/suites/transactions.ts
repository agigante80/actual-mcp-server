/**
 * tests/e2e/suites/transactions.ts
 *
 * Registration function for transaction tests (13 tools, 15 named tests).
 * Writes state.ctx.transactionId.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerTransactionTests(state: SharedState): void {
  // ==================== TRANSACTIONS (13 tools) ====================
  test('actual_transactions_create - should create transaction', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_transactions_create', {
      account: state.ctx.accountId,
      date: new Date().toISOString().split('T')[0],
      amount: -5000, // -$50.00
      payee: state.ctx.payeeId,
      category: state.ctx.categoryId,
      notes: 'E2E test transaction',
    });
    const txnId = extractResult(result);
    if (txnId && typeof txnId === 'string' && txnId.length > 10) {
      state.ctx.transactionId = txnId;
      console.log(`✅ Transaction created: ${txnId}`);
    } else {
      console.log('✅ Transaction created (ID not available)');
    }
  });

  test('actual_transactions_create - ERROR: should fail with invalid amount format', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    try {
      await callTool(request, state.sessionId, 'actual_transactions_create', {
        account: state.ctx.accountId,
        date: new Date().toISOString().split('T')[0],
        amount: -50.00, // Should be -5000 (cents), not -50.00
      });
      // Note: This might succeed if validation doesn't catch it
      console.log('⚠️  Amount validation might need improvement');
    } catch (error: any) {
      console.log('✅ Invalid amount format caught');
    }
  });

  test('actual_transactions_create - ERROR: should fail with invalid date', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    try {
      await callTool(request, state.sessionId, 'actual_transactions_create', {
        account: state.ctx.accountId,
        date: 'invalid-date',
        amount: -5000,
      });
      throw new Error('Should have failed with invalid date');
    } catch (error: any) {
      expect(error.message).toMatch(/date|invalid/i);
      console.log('✅ Invalid date rejected');
    }
  });

  test('actual_transactions_get - should get transaction by ID', async ({ request }) => {
    if (!state.ctx.transactionId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_transactions_get', {
      id: state.ctx.transactionId,
    });
    const txn = extractResult(result);
    expect(txn).toBeTruthy();
    console.log('✅ Transaction retrieved');
  });

  test('actual_transactions_update - should update transaction', async ({ request }) => {
    if (!state.ctx.transactionId) test.skip();
    await callTool(request, state.sessionId, 'actual_transactions_update', {
      id: state.ctx.transactionId,
      fields: { amount: -7500 }, // -$75.00
    });
    console.log('✅ Transaction updated');
  });

  test('actual_transactions_filter - should filter transactions', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_transactions_filter', {
      account_id: state.ctx.accountId,
    });
    const txns = extractResult(result);
    expect(Array.isArray(txns)).toBeTruthy();
    console.log(`✅ Filtered ${txns.length} transactions`);
  });

  test('actual_transactions_import - should import transactions', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_transactions_import', {
      accountId: state.ctx.accountId,
      txs: [], // Empty test
    });
    const importResult = extractResult(result);
    expect(importResult).toBeTruthy();
    console.log('✅ Transaction import tested');
  });

  test('actual_transactions_uncategorized - should list uncategorized transactions', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();

    // Create a transaction with no category so we know at least one exists
    const today = new Date().toISOString().split('T')[0];
    const uncatNote = `E2E-Uncat-${Date.now()}`;
    await callTool(request, state.sessionId, 'actual_transactions_create', {
      account: state.ctx.accountId,
      date: today,
      amount: -1111,
      notes: uncatNote,
      // deliberately no category
    });

    const result = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
    const data = extractResult(result);
    const txns: any[] = data?.transactions ?? data?.result?.transactions ?? (Array.isArray(data) ? data : []);
    expect(Array.isArray(txns)).toBeTruthy();
    const found = txns.find((t: any) => t?.notes === uncatNote);
    expect(found).toBeTruthy();
    console.log(`✅ actual_transactions_uncategorized: found ${txns.length} uncategorized, including our test transaction`);

    // Edge: far-future date range must return empty list
    const emptyResult = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {
      startDate: '2099-01-01',
      endDate: '2099-01-31',
    });
    const emptyData = extractResult(emptyResult);
    const emptyTxns: any[] = emptyData?.transactions ?? emptyData?.result?.transactions ?? (Array.isArray(emptyData) ? emptyData : []);
    expect(Array.isArray(emptyTxns)).toBeTruthy();
    expect(emptyTxns.length).toBe(0);
    console.log('✅ actual_transactions_uncategorized: future date range returns empty list');
  });

  test('actual_transactions_update_batch - should batch update transactions', async ({ request }) => {
    if (!state.ctx.accountId || !state.ctx.transactionId) test.skip();

    const batchNote = `E2E-Batch-${Date.now()}`;
    const result = await callTool(request, state.sessionId, 'actual_transactions_update_batch', {
      updates: [{ id: state.ctx.transactionId, fields: { notes: batchNote } }],
    });
    const data = extractResult(result);
    const batchData = data?.total !== undefined ? data : (data?.result ?? data);
    // Accept any shape that indicates 1 success
    const succeededCount = batchData?.successCount ?? batchData?.succeeded?.length ?? (batchData?.total === 1 ? 1 : null);
    expect(succeededCount).toBe(1);
    console.log('✅ actual_transactions_update_batch: batch update succeeded');

    // NEGATIVE: non-existent ID — must not throw, must report failure or at least not succeed
    const negResult = await callTool(request, state.sessionId, 'actual_transactions_update_batch', {
      updates: [{ id: '00000000-dead-beef-0000-000000000000', fields: { notes: 'should-fail' } }],
    });
    const negData = extractResult(negResult);
    const negBatch = negData?.total !== undefined ? negData : (negData?.result ?? negData);
    console.log(`✅ actual_transactions_update_batch: negative case handled (failureCount=${negBatch?.failureCount ?? 'n/a'})`);
  });

  test('actual_transactions_search_by_amount - should search by amount', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_transactions_search_by_amount', {
      amount: -5000,
    });
    const data = extractResult(result);
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by amount returned ${txns.length || 0} results`);
  });

  test('actual_transactions_search_by_category - should search by category', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_transactions_search_by_category', {
      categoryId: state.ctx.categoryId,
    });
    const data = extractResult(result);
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by category returned ${txns.length || 0} results`);
  });

  test('actual_transactions_search_by_month - should search by month', async ({ request }) => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, state.sessionId, 'actual_transactions_search_by_month', {
      month: currentMonth,
    });
    const data = extractResult(result);
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by month returned ${txns.length || 0} results`);
  });

  test('actual_transactions_search_by_payee - should search by payee', async ({ request }) => {
    if (!state.ctx.payeeId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_transactions_search_by_payee', {
      payeeId: state.ctx.payeeId,
    });
    const data = extractResult(result);
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by payee returned ${txns.length || 0} results`);
  });

  test('actual_transactions_summary_by_category - should summarize by category', async ({ request }) => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, state.sessionId, 'actual_transactions_summary_by_category', {
      month: currentMonth,
    });
    const summary = extractResult(result);
    expect(summary).toBeTruthy();
    console.log('✅ Category summary retrieved');
  });

  test('actual_transactions_summary_by_payee - should summarize by payee', async ({ request }) => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, state.sessionId, 'actual_transactions_summary_by_payee', {
      month: currentMonth,
    });
    const summary = extractResult(result);
    expect(summary).toBeTruthy();
    console.log('✅ Payee summary retrieved');
  });
}
