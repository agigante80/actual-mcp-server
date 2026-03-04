/**
 * tests/e2e/suites/categories.ts
 *
 * Registration function for category group tests (4 tools) and category tests (4 tools).
 * Writes state.ctx.categoryGroupId and state.ctx.categoryId for use by later suites.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerCategoryTests(state: SharedState): void {
  // ==================== CATEGORY GROUPS (4 tools) ====================
  test('actual_category_groups_get - should list category groups', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_category_groups_get');
    const groups = extractResult(result);
    expect(groups).toBeTruthy();
    console.log('✅ Category groups listed');
  });

  test('actual_category_groups_create - should create category group', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_category_groups_create', {
      name: `E2E-Group-${Date.now()}`,
    });
    const groupId = extractResult(result);
    expect(groupId).toBeTruthy();
    state.ctx.categoryGroupId = groupId;
    console.log(`✅ Category group created: ${groupId}`);
  });

  test('actual_category_groups_update - should update category group', async ({ request }) => {
    if (!state.ctx.categoryGroupId) test.skip();
    const groupId = typeof state.ctx.categoryGroupId === 'string'
      ? state.ctx.categoryGroupId
      : (state.ctx.categoryGroupId as any).id || String(state.ctx.categoryGroupId);
    await callTool(request, state.sessionId, 'actual_category_groups_update', {
      id: groupId,
      fields: { name: 'E2E-Group-Updated' },
    });
    console.log('✅ Category group updated');
  });

  // ==================== CATEGORIES (4 tools) ====================
  test('actual_categories_get - should list categories', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_categories_get');
    const categories = extractResult(result);
    expect(categories).toBeTruthy();
    console.log('✅ Categories listed');
  });

  test('actual_categories_create - should create category', async ({ request }) => {
    if (!state.ctx.categoryGroupId) test.skip();
    const groupId = typeof state.ctx.categoryGroupId === 'string'
      ? state.ctx.categoryGroupId
      : (state.ctx.categoryGroupId as any).id || String(state.ctx.categoryGroupId);
    const result = await callTool(request, state.sessionId, 'actual_categories_create', {
      name: `E2E-Category-${Date.now()}`,
      group_id: groupId,
    });
    const data = extractResult(result);
    const categoryId = typeof data === 'string' ? data : data?.categoryId;
    expect(categoryId).toBeTruthy();
    state.ctx.categoryId = categoryId;
    console.log(`✅ Category created: ${categoryId}`);
  });

  test('actual_categories_create - ERROR: should fail without group_id', async ({ request }) => {
    try {
      await callTool(request, state.sessionId, 'actual_categories_create', {
        name: 'Test-No-Group',
      });
      throw new Error('Should have failed without group_id');
    } catch (error: any) {
      expect(error.message).toMatch(/group_id|required/i);
      console.log('✅ Missing group_id rejected');
    }
  });

  test('actual_categories_update - should update category', async ({ request }) => {
    if (!state.ctx.categoryId) test.skip();
    const categoryId = typeof state.ctx.categoryId === 'string'
      ? state.ctx.categoryId
      : (state.ctx.categoryId as any).id || String(state.ctx.categoryId);
    await callTool(request, state.sessionId, 'actual_categories_update', {
      id: categoryId,
      fields: { name: 'E2E-Category-Updated' },
    });
    console.log('✅ Category updated');
  });
}
