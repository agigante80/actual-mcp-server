/**
 * tests/e2e/suites/schedules.ts
 *
 * Registration function for schedule tests (4 tools, 4 named tests).
 * The schedules_delete test is included here — it is part of the schedule workflow
 * (create → update → delete), not a standalone cleanup operation.
 * Writes/clears state.ctx.scheduleOneOffId.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerScheduleTests(state: SharedState): void {
  // ==================== SCHEDULES (4 tools) ====================
  test('actual_schedules_get - should list schedules', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_schedules_get');
    const data = extractResult(result);
    const schedules: any[] = data?.schedules ?? data?.result?.schedules ?? (Array.isArray(data) ? data : []);
    expect(Array.isArray(schedules)).toBeTruthy();
    console.log(`✅ Listed ${schedules.length} schedules`);
  });

  test('actual_schedules_create - should create one-off schedule', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_schedules_create', {
      name: `E2E-Schedule-${Date.now()}`,
      date: '2026-06-15',
      amount: -5000,
      amountOp: 'is',
      posts_transaction: false,
    });
    const data = extractResult(result);
    const scheduleId: string = data?.id ?? data?.result?.id ?? data;
    expect(typeof scheduleId).toBe('string');
    expect(scheduleId.length).toBeGreaterThan(8);
    state.ctx.scheduleOneOffId = scheduleId;
    console.log(`✅ Schedule created: ${scheduleId}`);
  });

  test('actual_schedules_update - should update schedule name', async ({ request }) => {
    if (!state.ctx.scheduleOneOffId) test.skip();
    const updatedName = `E2E-Schedule-Updated-${Date.now()}`;
    const result = await callTool(request, state.sessionId, 'actual_schedules_update', {
      id: state.ctx.scheduleOneOffId,
      name: updatedName,
    });
    const data = extractResult(result);
    expect(data?.success ?? data?.result?.success).toBe(true);
    // Verify name changed in the list
    const listResult = await callTool(request, state.sessionId, 'actual_schedules_get');
    const listData = extractResult(listResult);
    const schedules: any[] = listData?.schedules ?? listData?.result?.schedules ?? (Array.isArray(listData) ? listData : []);
    const found = schedules.find((s: any) => s.id === state.ctx.scheduleOneOffId);
    expect(found?.name).toBe(updatedName);
    console.log('✅ Schedule updated and name verified in list');
  });

  test('actual_schedules_delete - should delete schedule and verify gone', async ({ request }) => {
    if (!state.ctx.scheduleOneOffId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_schedules_delete', {
      id: state.ctx.scheduleOneOffId,
    });
    const data = extractResult(result);
    expect(data?.success ?? data?.result?.success).toBe(true);
    // Verify it no longer appears in the list
    const listResult = await callTool(request, state.sessionId, 'actual_schedules_get');
    const listData = extractResult(listResult);
    const schedules: any[] = listData?.schedules ?? listData?.result?.schedules ?? (Array.isArray(listData) ? listData : []);
    const stillThere = schedules.find((s: any) => s.id === state.ctx.scheduleOneOffId);
    expect(stillThere).toBeFalsy();
    state.ctx.scheduleOneOffId = undefined; // self-cleaned
    console.log('✅ Schedule deleted and confirmed absent from list');
  });
}
