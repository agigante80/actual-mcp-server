/**
 * tests/e2e/suites/budgets.ts
 *
 * Registration function for budget tests (9 tools incl. batch, 10 named tests).
 * Reads state.ctx.categoryId and state.ctx.categoryGroupId.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerBudgetTests(state: SharedState): void {
  // ==================== BUDGETS (9 tools) ====================
  test('actual_budgets_get_all - should get all budgets', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_budgets_get_all');
    const budgets = extractResult(result);
    expect(budgets).toBeTruthy();
    console.log('✅ All budgets retrieved');
  });

  test('actual_budgets_getMonth - should get month budget', async ({ request }) => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, state.sessionId, 'actual_budgets_getMonth', {
      month: currentMonth,
    });
    const budget = extractResult(result);
    expect(budget).toBeTruthy();
    console.log('✅ Month budget retrieved');
  });

  test('actual_budgets_getMonths - should get multiple months', async ({ request }) => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, state.sessionId, 'actual_budgets_getMonths', {
      start: currentMonth,
      end: currentMonth,
    });
    const data = extractResult(result);
    const months = Array.isArray(data) ? data : (data?.months || []);
    expect(months).toBeTruthy();
    console.log(`✅ Retrieved ${months.length || 0} months`);
  });

  test('actual_budgets_setAmount - should set budget amount', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, state.sessionId, 'actual_budgets_setAmount', {
      month: currentMonth,
      categoryId: state.ctx.categoryId,
      amount: 50000,
    });
    console.log('✅ Budget amount set');
  });

  test('actual_budgets_setCarryover - should set carryover', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, state.sessionId, 'actual_budgets_setCarryover', {
      month: currentMonth,
      categoryId: state.ctx.categoryId,
      flag: true,
    });
    console.log('✅ Carryover set');
  });

  test('actual_budgets_holdForNextMonth - should hold for next month', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, state.sessionId, 'actual_budgets_holdForNextMonth', {
      month: currentMonth,
      categoryId: state.ctx.categoryId,
      amount: 10000,
    });
    console.log('✅ Budget held for next month');
  });

  test('actual_budgets_resetHold - should reset hold', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, state.sessionId, 'actual_budgets_resetHold', {
      month: currentMonth,
      categoryId: state.ctx.categoryId,
    });
    console.log('✅ Hold reset');
  });

  test('actual_budget_updates_batch - should batch update budgets', async ({ request }) => {
    test.setTimeout(60000); // Batch operations can take longer
    if (!state.ctx.categoryId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, state.sessionId, 'actual_budget_updates_batch', {
      operations: [{ month: currentMonth, categoryId: state.ctx.categoryId, amount: 60000 }],
    });
    const batchResult = extractResult(result);
    expect(batchResult).toBeTruthy();
    console.log('✅ Batch update completed');
  });

  test('actual_budget_updates_batch - should handle large batch (35 ops)', async ({ request }) => {
    test.setTimeout(60000); // Large batch operations can take longer
    if (!state.ctx.categoryId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    const operations = [];
    for (let i = 0; i < 35; i++) {
      operations.push({
        month: currentMonth,
        categoryId: state.ctx.categoryId,
        amount: 10000 + (i * 100),
      });
    }
    const result = await callTool(request, state.sessionId, 'actual_budget_updates_batch', {
      operations,
    });
    const batchResult = extractResult(result);
    expect(batchResult).toBeTruthy();
    console.log('✅ Large batch handled successfully');
  });

  test('actual_budgets_transfer - should transfer between categories', async ({ request }) => {
    if (!state.ctx.categoryId || !state.ctx.categoryGroupId) test.skip();
    const currentMonth = new Date().toISOString().substring(0, 7);
    const groupId = typeof state.ctx.categoryGroupId === 'string'
      ? state.ctx.categoryGroupId
      : (state.ctx.categoryGroupId as any).id || String(state.ctx.categoryGroupId);

    // Create a second category to transfer to
    const result = await callTool(request, state.sessionId, 'actual_categories_create', {
      name: `E2E-Transfer-Target-${Date.now()}`,
      group_id: groupId,
    });
    const data = extractResult(result);
    const targetCategoryId = typeof data === 'string' ? data : data?.categoryId;

    await callTool(request, state.sessionId, 'actual_budgets_transfer', {
      month: currentMonth,
      amount: 5000,
      fromCategoryId: state.ctx.categoryId,
      toCategoryId: targetCategoryId,
    });
    console.log('✅ Budget transferred');
  });
}
