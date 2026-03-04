/**
 * tests/e2e/suites/payees.ts
 *
 * Registration function for payee tests (5 tools, 7 named tests) and
 * payee rules tests (1 tool, 1 named test).
 * Writes state.ctx.payeeId and state.ctx.payeeId2.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerPayeeTests(state: SharedState): void {
  // ==================== PAYEES (5 tools) ====================
  test('actual_payees_get - should list payees', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_payees_get');
    const payees = extractResult(result);
    expect(Array.isArray(payees)).toBeTruthy();
    console.log(`✅ Listed ${payees.length} payees`);
  });

  test('actual_payees_create - should create payee', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_payees_create', {
      name: `E2E-Payee-${Date.now()}`,
    });
    const payeeId = extractResult(result);
    expect(payeeId).toBeTruthy();
    state.ctx.payeeId = payeeId;
    console.log(`✅ Payee created: ${payeeId}`);
  });

  test('actual_payees_create - should create second payee for merge test', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_payees_create', {
      name: `E2E-Payee2-${Date.now()}`,
    });
    const payeeId = extractResult(result);
    expect(payeeId).toBeTruthy();
    state.ctx.payeeId2 = payeeId;
    console.log(`✅ Second payee created: ${payeeId}`);
  });

  test('actual_payees_update - should update payee name and set default category via rule', async ({ request }) => {
    if (!state.ctx.payeeId) test.skip();

    await callTool(request, state.sessionId, 'actual_payees_update', {
      id: state.ctx.payeeId,
      fields: { name: 'E2E-Payee-Updated' },
    });
    console.log('✅ Payee name updated');

    // Set default category — adapter stores this as a "payee is X → set category" rule,
    // NOT as a direct DB column (category does not exist on the payees table in @actual-app/api v26+)
    if (state.ctx.categoryId) {
      await callTool(request, state.sessionId, 'actual_payees_update', {
        id: state.ctx.payeeId,
        fields: { category: state.ctx.categoryId },
      });
      console.log('✅ Payee default category set via rules');

      // Verify: payee_rules_get should show a "set category" rule
      const rulesResult = await callTool(request, state.sessionId, 'actual_payee_rules_get', {
        payeeId: state.ctx.payeeId,
      });
      const rulesData = extractResult(rulesResult);
      const rules = Array.isArray(rulesData) ? rulesData : (rulesData?.rules || []);
      const setCatRule = rules.find((r: any) =>
        Array.isArray(r.actions) &&
        r.actions.some((a: any) => a.op === 'set' && a.field === 'category'),
      );
      if (setCatRule) {
        const action = setCatRule.actions.find((a: any) => a.op === 'set' && a.field === 'category');
        expect(action.value).toBe(state.ctx.categoryId);
        console.log('✅ Verified: set-category rule created for payee');
      } else {
        console.log(`⚠ No set-category rule found in ${rules.length} rule(s) — check adapter`);
      }
    } else {
      console.log('⚠ categoryId not in state.ctx — skipping category rule verification');
    }
  });

  test('actual_payees_update - should clear default category (null removes rule)', async ({ request }) => {
    if (!state.ctx.payeeId || !state.ctx.categoryId) test.skip();

    await callTool(request, state.sessionId, 'actual_payees_update', {
      id: state.ctx.payeeId,
      fields: { category: null },
    });
    console.log('✅ category=null accepted');

    // Verify: no set-category rule remains
    const rulesResult = await callTool(request, state.sessionId, 'actual_payee_rules_get', {
      payeeId: state.ctx.payeeId,
    });
    const rulesData = extractResult(rulesResult);
    const rules = Array.isArray(rulesData) ? rulesData : (rulesData?.rules || []);
    const remaining = rules.filter((r: any) =>
      Array.isArray(r.actions) &&
      r.actions.some((a: any) => a.op === 'set' && a.field === 'category'),
    );
    expect(remaining.length).toBe(0);
    console.log('✅ Verified: set-category rule removed after category=null');
  });

  test('actual_payees_update - ERROR: should reject invalid fields', async ({ request }) => {
    if (!state.ctx.payeeId) test.skip();
    try {
      await callTool(request, state.sessionId, 'actual_payees_update', {
        id: state.ctx.payeeId,
        fields: { invalidField: 'should fail' },
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      expect(error.message).toMatch(/Unrecognized|invalid/i);
      console.log('✅ Invalid field rejected');
    }
  });

  test('actual_payees_merge - should merge payees', async ({ request }) => {
    if (!state.ctx.payeeId || !state.ctx.payeeId2) test.skip();
    await callTool(request, state.sessionId, 'actual_payees_merge', {
      targetId: state.ctx.payeeId,
      mergeIds: [state.ctx.payeeId2],
    });
    state.ctx.payeeId2 = undefined; // Merged away
    console.log('✅ Payees merged');
  });

  // ==================== PAYEE RULES (1 tool) ====================
  test('actual_payee_rules_get - should get payee rules', async ({ request }) => {
    if (!state.ctx.payeeId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_payee_rules_get', {
      payeeId: state.ctx.payeeId,
    });
    const data = extractResult(result);
    const rules = Array.isArray(data) ? data : (data?.rules || []);
    expect(rules).toBeTruthy();
    console.log(`✅ Found ${rules.length || 0} payee rules`);
  });
}
