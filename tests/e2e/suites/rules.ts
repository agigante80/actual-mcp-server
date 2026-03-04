/**
 * tests/e2e/suites/rules.ts
 *
 * Registration function for rule tests (4 tools, 5 named tests).
 * Writes state.ctx.ruleId, state.ctx.ruleWithoutOpId, and state.ctx.rulesUpsertId.
 *
 * Note on actual_rules_create_or_update: uses parseUpsert() instead of extractResult()
 * because extractResult() reduces {id, created} to just the id string (losing `created`).
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerRuleTests(state: SharedState): void {
  // ==================== RULES (4 tools) ====================
  test('actual_rules_get - should list rules', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_rules_get');
    const data = extractResult(result);
    const rules = Array.isArray(data) ? data : (data?.rules || []);
    expect(rules).toBeTruthy();
    console.log(`✅ Listed ${rules.length || 0} rules`);
  });

  test('actual_rules_create - should create rule without op field', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_rules_create', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'contains', value: 'no-op-test' }],
      actions: [{ field: 'category', value: state.ctx.categoryId }], // No 'op'
    });
    const ruleId = extractResult(result);
    expect(ruleId).toBeTruthy();
    state.ctx.ruleWithoutOpId = ruleId;
    console.log('✅ Rule created without op field');
  });

  test('actual_rules_create - should create rule with op field', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_rules_create', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'contains', value: 'test-marker' }],
      actions: [{ op: 'set', field: 'category', value: state.ctx.categoryId }],
    });
    const ruleId = extractResult(result);
    expect(ruleId).toBeTruthy();
    state.ctx.ruleId = ruleId;
    console.log('✅ Rule created with op field');
  });

  test('actual_rules_update - should update rule', async ({ request }) => {
    if (!state.ctx.ruleId) test.skip();
    await callTool(request, state.sessionId, 'actual_rules_update', {
      id: state.ctx.ruleId,
      fields: {
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [{ field: 'notes', op: 'contains', value: 'updated-marker' }],
        actions: [{ op: 'set', field: 'category', value: state.ctx.categoryId }],
      },
    });
    console.log('✅ Rule updated');
  });

  test('actual_rules_create_or_update - should upsert rule idempotently', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();

    const marker = `E2E-Upsert-${Date.now()}`;
    const conditions = [{ field: 'notes', op: 'contains', value: marker }];
    const actions = [{ op: 'set', field: 'category', value: state.ctx.categoryId }];

    // Parse raw MCP envelope directly to preserve the { id, created } shape.
    // extractResult() reduces objects with an 'id' field down to just the id string,
    // which would cause firstData?.created to be undefined.
    const parseUpsert = (raw: any): { id: string; created: boolean } =>
      raw?.content?.[0]?.text ? JSON.parse(raw.content[0].text) : raw;

    // First call: must create (created=true)
    const first = await callTool(request, state.sessionId, 'actual_rules_create_or_update', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions,
      actions,
    });
    const firstData = parseUpsert(first);
    expect(typeof firstData.id).toBe('string');
    expect(firstData.created).toBe(true);
    state.ctx.rulesUpsertId = firstData.id;
    console.log(`✅ actual_rules_create_or_update: created=true, id=${firstData.id}`);

    // Second call with identical conditions: must update (created=false, same id)
    const second = await callTool(request, state.sessionId, 'actual_rules_create_or_update', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions,
      actions,
    });
    const secondData = parseUpsert(second);
    expect(secondData.id).toBe(firstData.id);
    expect(secondData.created).toBe(false);
    console.log('✅ actual_rules_create_or_update: second call created=false, same id (idempotent)');
  });
}
