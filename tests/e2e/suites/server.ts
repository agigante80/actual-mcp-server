/**
 * tests/e2e/suites/server.ts
 *
 * Registration function for server_info and session management tests (4 tests).
 * Call registerServerTests(state) from within a test.describe block.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerServerTests(state: SharedState): void {
  // ==================== SERVER INFO ====================
  test('actual_server_info - should return server info', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_server_info');
    const data = extractResult(result);
    expect(data).toBeTruthy();
    console.log('✅ Server info retrieved');
  });

  test('actual_server_get_version - should return version string', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_server_get_version');
    const data = extractResult(result);
    expect(data).toBeTruthy();
    console.log(`✅ Server version: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  });

  // ==================== SESSION MANAGEMENT ====================
  test('actual_session_list - should list active sessions', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_session_list');
    const data = extractResult(result);
    const sessions = Array.isArray(data) ? data : (data?.sessions || []);
    expect(sessions).toBeTruthy();
    console.log(`✅ Found ${sessions.length || 0} active sessions`);
  });

  test('actual_session_close - should handle close request gracefully', async ({ request }) => {
    // Call with no sessionId: tool will try to close oldest idle session other than the current one.
    // In a single-session test environment it returns a non-error informational response — both
    // success and "no idle sessions / won't close current session" are acceptable outcomes.
    const result = await callTool(request, state.sessionId, 'actual_session_close', {});
    const data = extractResult(result);
    expect(data).toBeTruthy();
    expect(typeof data).toBe('object');
    console.log(`✅ actual_session_close responded: ${data?.message ?? data?.success ?? JSON.stringify(data)}`);
  });
}
