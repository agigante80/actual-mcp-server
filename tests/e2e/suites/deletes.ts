/**
 * tests/e2e/suites/deletes.ts
 *
 * Registration function for delete tool tests.
 * Runs in dependency order so that foreign-key constraints are respected:
 *   transactions → rules → payees → categories → category_groups → accounts
 *
 * Note: actual_schedules_delete is self-contained in schedules.ts.
 *
 * All delete tools accept { id: string } (singular — one call per resource).
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerDeleteTests(state: SharedState): void {
  // ==================== DELETES (ordered) ====================

  test('actual_transactions_delete - should delete test transaction', async ({ request }) => {
    if (!state.ctx.transactionId) {
      console.log('⚠️  No transactionId — skipping transactions_delete');
      return;
    }
    await callTool(request, state.sessionId, 'actual_transactions_delete', {
      id: state.ctx.transactionId,
    });
    // Verify deletion via get — use accountId filter to scan owning account
    if (state.ctx.accountId) {
      const listResult = await callTool(request, state.sessionId, 'actual_transactions_get', {
        accountId: state.ctx.accountId,
      });
      const data = extractResult(listResult);
      const txns = Array.isArray(data) ? data : (data?.result ?? []);
      const ids = Array.isArray(txns) ? txns.map((t: any) => t.id) : [];
      expect(ids).not.toContain(state.ctx.transactionId);
    }
    state.ctx.transactionId = undefined;
    console.log('✅ Test transaction deleted and confirmed absent');
  });

  test('actual_rules_delete - should delete all test rules', async ({ request }) => {
    const toDelete = [state.ctx.ruleWithoutOpId, state.ctx.ruleId, state.ctx.rulesUpsertId].filter(Boolean) as string[];
    if (toDelete.length === 0) {
      console.log('⚠️  No rule IDs — skipping rules_delete');
      return;
    }
    // Each rule requires its own delete call (tool accepts singular id)
    for (const id of toDelete) {
      await callTool(request, state.sessionId, 'actual_rules_delete', { id });
    }
    // Verify none remain in the rules list
    const listResult = await callTool(request, state.sessionId, 'actual_rules_get');
    const data = extractResult(listResult);
    const rules: any[] = Array.isArray(data) ? data : (data?.rules ?? []);
    const remaining = rules.filter((r: any) => toDelete.includes(r.id));
    expect(remaining).toHaveLength(0);
    state.ctx.ruleWithoutOpId = undefined;
    state.ctx.ruleId = undefined;
    state.ctx.rulesUpsertId = undefined;
    console.log(`✅ ${toDelete.length} test rule(s) deleted and confirmed absent`);
  });

  test('actual_payees_delete - should delete test payees', async ({ request }) => {
    const toDelete = [state.ctx.payeeId, state.ctx.payeeId2].filter(Boolean) as string[];
    if (toDelete.length === 0) {
      console.log('⚠️  No payee IDs — skipping payees_delete');
      return;
    }
    // Each payee requires its own delete call (tool accepts singular id)
    for (const id of toDelete) {
      await callTool(request, state.sessionId, 'actual_payees_delete', { id });
    }
    // Verify none remain in the payees list
    const listResult = await callTool(request, state.sessionId, 'actual_payees_get');
    const payees = extractResult(listResult);
    const ids = Array.isArray(payees) ? payees.map((p: any) => p.id) : [];
    for (const id of toDelete) {
      expect(ids).not.toContain(id);
    }
    state.ctx.payeeId = undefined;
    state.ctx.payeeId2 = undefined;
    console.log(`✅ ${toDelete.length} test payee(s) deleted and confirmed absent`);
  });

  test('actual_categories_delete - should delete test category', async ({ request }) => {
    if (!state.ctx.categoryId) {
      console.log('⚠️  No categoryId — skipping categories_delete');
      return;
    }
    await callTool(request, state.sessionId, 'actual_categories_delete', {
      id: state.ctx.categoryId,
    });
    // Verify deletion via list
    const listResult = await callTool(request, state.sessionId, 'actual_categories_get');
    const data = extractResult(listResult);
    const categories: any[] = Array.isArray(data) ? data : (data?.categories ?? []);
    const stillThere = categories.find((c: any) => c.id === state.ctx.categoryId);
    expect(stillThere).toBeFalsy();
    state.ctx.categoryId = undefined;
    console.log('✅ Test category deleted and confirmed absent');
  });

  test('actual_category_groups_delete - should delete test category group', async ({ request }) => {
    if (!state.ctx.categoryGroupId) {
      console.log('⚠️  No categoryGroupId — skipping category_groups_delete');
      return;
    }
    await callTool(request, state.sessionId, 'actual_category_groups_delete', {
      id: state.ctx.categoryGroupId,
    });
    // Verify deletion via list
    const listResult = await callTool(request, state.sessionId, 'actual_category_groups_get');
    const groups = extractResult(listResult);
    const ids = Array.isArray(groups) ? groups.map((g: any) => g.id) : [];
    expect(ids).not.toContain(state.ctx.categoryGroupId);
    state.ctx.categoryGroupId = undefined;
    console.log('✅ Test category group deleted and confirmed absent');
  });

  test('actual_accounts_delete - should delete test account', async ({ request }) => {
    if (!state.ctx.accountId) {
      console.log('⚠️  No accountId — skipping accounts_delete');
      return;
    }
    await callTool(request, state.sessionId, 'actual_accounts_delete', {
      id: state.ctx.accountId,
    });
    // Verify deletion via list
    const listResult = await callTool(request, state.sessionId, 'actual_accounts_list');
    const accounts = extractResult(listResult);
    const ids = Array.isArray(accounts) ? accounts.map((a: any) => a.id) : [];
    expect(ids).not.toContain(state.ctx.accountId);
    state.ctx.accountId = undefined;
    state.ctx.accountName = undefined;
    console.log('✅ Test account deleted and confirmed absent');
  });
}
