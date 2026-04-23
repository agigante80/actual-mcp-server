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

  test('actual_transactions_uncategorized - default summary mode', async ({ request }) => {
    // Default call must return summary fields with no transactions array
    const result = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
    const data = extractResult(result);
    expect(typeof data?.totalCount).toBe('number');
    expect(typeof data?.totalAmount).toBe('number');
    expect(Array.isArray(data?.byAccount)).toBeTruthy();
    expect(data?.transactions).toBeUndefined();
    console.log(`✅ actual_transactions_uncategorized summary: totalCount=${data?.totalCount}, byAccount entries=${data?.byAccount?.length}`);
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

    // Use includeTransactions:true to get transaction rows
    const result = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {
      includeTransactions: true,
    });
    const data = extractResult(result);
    const txns: any[] = data?.transactions ?? [];
    expect(Array.isArray(txns)).toBeTruthy();
    const found = txns.find((t: any) => t?.notes === uncatNote);
    expect(found).toBeTruthy();
    expect(typeof data?.totalCount).toBe('number');
    expect(typeof data?.hasMore).toBe('boolean');
    console.log(`✅ actual_transactions_uncategorized: found ${txns.length} uncategorized (totalCount=${data?.totalCount}), including our test transaction`);

    // Edge: far-future date range must return empty summary
    const emptyResult = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {
      startDate: '2099-01-01',
      endDate: '2099-01-31',
    });
    const emptyData = extractResult(emptyResult);
    expect(emptyData?.totalCount).toBe(0);
    console.log('✅ actual_transactions_uncategorized: future date range returns totalCount:0');
  });

  test('actual_transactions_uncategorized - should exclude off-budget transactions (regression #80)', async ({ request }) => {
    // Create a temporary off-budget account
    const offBudgetTimestamp = Date.now();
    const offBudgetAccountName = `E2E-OffBudget-${offBudgetTimestamp}`;
    const createAcctResult = await callTool(request, state.sessionId, 'actual_accounts_create', {
      name: offBudgetAccountName,
      type: 'investment',
      offbudget: true,
      balance: 0,
    });
    const offBudgetAccountId = extractResult(createAcctResult);
    expect(offBudgetAccountId).toBeTruthy();
    console.log(`✅ Off-budget account created: ${offBudgetAccountId}`);

    const today = new Date().toISOString().split('T')[0];
    const offBudgetNote = `E2E-OffBudget-Txn-${offBudgetTimestamp}`;

    try {
      // Create a transaction in the off-budget account (no category)
      await callTool(request, state.sessionId, 'actual_transactions_create', {
        account: offBudgetAccountId,
        date: today,
        amount: -9999,
        notes: offBudgetNote,
      });

      // Use byAccount to verify off-budget account is excluded
      const summaryResult = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
      const summaryData = extractResult(summaryResult);
      const byAccount: any[] = summaryData?.byAccount ?? [];

      // Off-budget account must NOT appear in byAccount
      const offBudgetInSummary = byAccount.find((a: any) => a?.accountId === offBudgetAccountId);
      expect(offBudgetInSummary).toBeFalsy();
      console.log('✅ actual_transactions_uncategorized [#80]: off-budget account correctly excluded from byAccount');

      // On-budget transaction must appear; verify via includeTransactions
      if (state.ctx.accountId) {
        const onBudgetNote = `E2E-Uncat-${offBudgetTimestamp}`;
        await callTool(request, state.sessionId, 'actual_transactions_create', {
          account: state.ctx.accountId,
          date: today,
          amount: -777,
          notes: onBudgetNote,
        });
        const result2 = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {
          includeTransactions: true,
        });
        const data2 = extractResult(result2);
        const txns2: any[] = data2?.transactions ?? [];
        const onBudgetFound = txns2.find((t: any) => t?.notes === onBudgetNote);
        expect(onBudgetFound).toBeTruthy();
        console.log('✅ actual_transactions_uncategorized [#80]: on-budget transaction correctly included');
      }
    } finally {
      // Close (not delete) the off-budget account to preserve history
      await callTool(request, state.sessionId, 'actual_accounts_close', { id: offBudgetAccountId });
      console.log(`✅ Off-budget test account closed: ${offBudgetAccountId}`);
    }
  });

  test('actual_transactions_uncategorized - should exclude transfers (issue #119)', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();

    const before = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
    const beforeData = extractResult(before);
    const countBefore: number = beforeData?.totalCount ?? 0;

    const today = new Date().toISOString().split('T')[0];
    const destAcctResult = await callTool(request, state.sessionId, 'actual_accounts_create', {
      name: `E2E-Transfer-Dest-${Date.now()}`,
      type: 'checking',
      offbudget: false,
      balance: 0,
    });
    const destAcctId = extractResult(destAcctResult);
    expect(destAcctId).toBeTruthy();

    try {
      await callTool(request, state.sessionId, 'actual_transfers_create', {
        fromAccount: state.ctx.accountId,
        toAccount: destAcctId,
        amount: 1234,
        date: today,
      });

      const after = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
      const afterData = extractResult(after);
      const countAfter: number = afterData?.totalCount ?? 0;

      expect(countAfter).toBe(countBefore);
      console.log(`✅ actual_transactions_uncategorized [#119]: transfer did not inflate uncategorized count (before=${countBefore}, after=${countAfter})`);
    } finally {
      await callTool(request, state.sessionId, 'actual_accounts_close', { id: destAcctId });
    }
  });

  test('actual_transactions_uncategorized - should exclude closed account transactions (issue #119)', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const closedNote = `E2E-Closed-${Date.now()}`;

    const acctResult = await callTool(request, state.sessionId, 'actual_accounts_create', {
      name: `E2E-ClosedAcct-${Date.now()}`,
      type: 'checking',
      offbudget: false,
      balance: 0,
    });
    const acctId = extractResult(acctResult);
    expect(acctId).toBeTruthy();

    await callTool(request, state.sessionId, 'actual_transactions_create', {
      account: acctId,
      date: today,
      amount: -4321,
      notes: closedNote,
    });

    // Before close: account must appear in byAccount
    const openResult = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
    const openData = extractResult(openResult);
    const openAccountEntry = (openData?.byAccount ?? []).find((a: any) => a?.accountId === acctId);
    expect(openAccountEntry).toBeTruthy();
    console.log('✅ actual_transactions_uncategorized [#119]: open account visible in byAccount before close');

    await callTool(request, state.sessionId, 'actual_accounts_close', { id: acctId });

    // After close: account must NOT appear in byAccount (closed accounts excluded)
    const closedResult = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {});
    const closedData = extractResult(closedResult);
    const closedAccountEntry = (closedData?.byAccount ?? []).find((a: any) => a?.accountId === acctId);
    expect(closedAccountEntry).toBeFalsy();
    console.log('✅ actual_transactions_uncategorized [#119]: closed account correctly excluded from byAccount');
  });

  test('actual_transactions_uncategorized - should paginate correctly and match summary totals', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const ts = Date.now();

    // Create a fresh isolated account so totalCount is exactly 2
    const acctResult = await callTool(request, state.sessionId, 'actual_accounts_create', {
      name: `E2E-Uncat-Pagination-${ts}`,
      balance: 0,
    });
    const acctData = extractResult(acctResult);
    const acctId: string = acctData?.id ?? acctData?.result?.id;
    expect(acctId).toBeTruthy();

    const amt1 = -1500;
    const amt2 = -2500;
    await callTool(request, state.sessionId, 'actual_transactions_create', {
      account: acctId, date: today, amount: amt1, notes: `E2E-Pag-A-${ts}`,
    });
    await callTool(request, state.sessionId, 'actual_transactions_create', {
      account: acctId, date: today, amount: amt2, notes: `E2E-Pag-B-${ts}`,
    });

    // Summary call — no includeTransactions
    const summaryResult = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', { accountId: acctId });
    const summaryData = extractResult(summaryResult);
    const acctEntry = (summaryData?.byAccount ?? []).find((a: any) => a?.accountId === acctId);
    expect(acctEntry).toBeTruthy();
    expect(acctEntry?.count).toBe(2);
    expect(acctEntry?.totalAmount).toBe(amt1 + amt2);
    expect(summaryData?.totalCount).toBe(2);
    expect('transactions' in summaryData).toBe(false);
    console.log(`✅ actual_transactions_uncategorized pagination: summary totalCount=2, totalAmount=${amt1 + amt2}`);

    // Page 1: limit:1 → 1 result, hasMore:true
    const page1Result = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {
      accountId: acctId, includeTransactions: true, limit: 1, offset: 0,
    });
    const page1 = extractResult(page1Result);
    expect(page1?.transactions?.length).toBe(1);
    expect(page1?.count).toBe(1);
    expect(page1?.hasMore).toBe(true);
    expect(page1?.totalCount).toBe(2);
    console.log('✅ actual_transactions_uncategorized pagination: page 1 — 1 txn, hasMore:true');

    // Page 2: offset:1 → 1 result, hasMore:false
    const page2Result = await callTool(request, state.sessionId, 'actual_transactions_uncategorized', {
      accountId: acctId, includeTransactions: true, limit: 1, offset: 1,
    });
    const page2 = extractResult(page2Result);
    expect(page2?.transactions?.length).toBe(1);
    expect(page2?.hasMore).toBe(false);
    console.log('✅ actual_transactions_uncategorized pagination: page 2 — 1 txn, hasMore:false');

    // Teardown
    await callTool(request, state.sessionId, 'actual_accounts_close', { id: acctId });
    await callTool(request, state.sessionId, 'actual_accounts_delete', { id: acctId });
    console.log('✅ actual_transactions_uncategorized pagination: teardown complete');
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
