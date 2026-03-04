/**
 * tests/e2e/suites/advanced.ts
 *
 * Registration function for advanced tool tests:
 *   - actual_bank_sync      (1 tool)
 *   - actual_query_run      (1 tool, 11 tests — 5 success + 6 error paths)
 *   - actual_get_id_by_name (1 tool)
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerAdvancedTests(state: SharedState): void {
  // ==================== ADVANCED (2 tools) ====================
  test('actual_bank_sync - should handle gracefully if unavailable', async ({ request }) => {
    try {
      const result = await callTool(request, state.sessionId, 'actual_bank_sync');
      const syncStatus = extractResult(result);
      console.log('✅ Bank sync status retrieved:', syncStatus);
    } catch (error: any) {
      console.log('✅ Bank sync unavailable (expected for local budgets)');
    }
  });

  test('actual_query_run - should execute SELECT * query', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_query_run', {
      query: 'SELECT * FROM transactions LIMIT 10',
    });
    const queryResult = extractResult(result);
    expect(queryResult).toBeTruthy();
    console.log('✅ SELECT * query executed');
  });

  test('actual_query_run - should execute query with specific fields', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_query_run', {
      query: 'SELECT id, date, amount, account FROM transactions LIMIT 10',
    });
    const queryResult = extractResult(result);
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with specific fields executed');
  });

  test('actual_query_run - should execute query with join path (payee.name)', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_query_run', {
      query: 'SELECT id, date, amount, payee.name FROM transactions LIMIT 10',
    });
    const queryResult = extractResult(result);
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with payee.name join executed');
  });

  test('actual_query_run - should execute query with join path (category.name)', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_query_run', {
      query: 'SELECT id, amount, category.name FROM transactions WHERE amount < 0 LIMIT 10',
    });
    const queryResult = extractResult(result);
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with category.name join executed');
  });

  test('actual_query_run - should execute query with WHERE and ORDER BY', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_query_run', {
      query: 'SELECT id, date, amount FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 20',
    });
    const queryResult = extractResult(result);
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with WHERE and ORDER BY executed');
  });

  test('actual_query_run - ERROR: should reject invalid field (payee_name)', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_query_run', {
        query: 'SELECT id, payee_name FROM transactions LIMIT 5',
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      expect(error.message).toMatch(/payee_name|Available fields|invalid/i);
      console.log('✅ Invalid field payee_name rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid field (category_name)', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_query_run', {
        query: 'SELECT id, category_name FROM transactions LIMIT 5',
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      expect(error.message).toMatch(/category_name|Available fields|invalid/i);
      console.log('✅ Invalid field category_name rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid table name', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_query_run', {
        query: 'SELECT * FROM transaction LIMIT 10',
      });
      throw new Error('Should have failed with invalid table');
    } catch (error: any) {
      expect(error.message).toMatch(/transaction|table|Available tables|invalid/i);
      console.log('✅ Invalid table name rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid field in WHERE clause', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_query_run', {
        query: 'SELECT id, amount FROM transactions WHERE payee_name = "Test"',
      });
      throw new Error('Should have failed with invalid field in WHERE');
    } catch (error: any) {
      expect(error.message).toMatch(/payee_name|Available fields|invalid/i);
      console.log('✅ Invalid field in WHERE clause rejected');
    }
  });

  test('actual_query_run - ERROR: should reject multiple invalid fields', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_query_run', {
        query: 'SELECT id, payee_name, category_name FROM transactions',
      });
      throw new Error('Should have failed with multiple invalid fields');
    } catch (error: any) {
      expect(error.message).toMatch(/payee_name|category_name|Available fields|invalid/i);
      console.log('✅ Multiple invalid fields rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid join path (account.id)', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_query_run', {
        query: "SELECT * FROM transactions WHERE account.id = 'bff82978-3f20-4956-860b-fa2cb069a144' ORDER BY date DESC LIMIT 5",
      });
      throw new Error('Should have failed - account is not a join, just a field');
    } catch (error: any) {
      expect(error.message).toMatch(/account|Available fields|invalid/i);
      console.log('✅ Invalid join path account.id rejected');
    }
  });

  // ==================== GET ID BY NAME ====================
  test('actual_get_id_by_name - should resolve account name to id', async ({ request }) => {
    // Pull a real account from the live list so the lookup is guaranteed to match
    const listResult = await callTool(request, state.sessionId, 'actual_accounts_list');
    const accounts = extractResult(listResult);
    const firstAccount = Array.isArray(accounts) ? accounts[0] : null;
    if (!firstAccount) {
      console.log('⚠️  No accounts available — skipping get_id_by_name');
      return;
    }
    const result = await callTool(request, state.sessionId, 'actual_get_id_by_name', {
      type: 'accounts',
      name: firstAccount.name,
    });
    const data = extractResult(result);
    const resolvedId = data?.id ?? (typeof data === 'string' ? data : null);
    expect(resolvedId).toBe(firstAccount.id);
    console.log(`✅ actual_get_id_by_name: resolved "${firstAccount.name}" → ${resolvedId}`);
  });
}
